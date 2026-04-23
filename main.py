import os
import uvicorn
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException, Header, Query, UploadFile, File
from fastapi.staticfiles import StaticFiles

from fastapi.security import OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel
from typing import List, Dict, Set, Optional
from datetime import datetime, timedelta

from sqlalchemy import create_engine, Column, Integer, String, ForeignKey, DateTime
from sqlalchemy.orm import sessionmaker, declarative_base, Session
from sqlalchemy import UnicodeText
from sqlalchemy import not_

from fastapi.responses import FileResponse

# =========================
# CONFIG
# =========================

SECRET_KEY = "SUPER_SECRET_KEY_CHANGE_ME"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7

DATABASE_URL = (
    "mssql+pyodbc://messenger_user:AsTrA134@localhost/Messenger"
    "?driver=ODBC+Driver+17+for+SQL+Server"
)

engine = create_engine(
    DATABASE_URL,
    connect_args={"timeout": 30}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


# =========================
# APP
# =========================

app = FastAPI(title="Synx Messenger API")

app.mount("/static", StaticFiles(directory="static"), name="static")


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

print("BASE_DIR =", BASE_DIR)
print("UPLOAD_DIR =", UPLOAD_DIR)
print("Working directory =", os.getcwd())


#app.mount(
#    "/uploads",
#    StaticFiles(directory=UPLOAD_DIR, html=False),
#    name="uploads"
#)
# =========================
# DB MODELS
# =========================

class User(Base):
    __tablename__ = "Users"

    id = Column("Id", Integer, primary_key=True, index=True)
    username = Column("Username", String(50), unique=True, index=True)
    password_hash = Column("password_hash", String(255))
    created_at = Column("CreatedAt", DateTime)
    status = Column("Status", String(20), default="online")
    avatar_url = Column("AvatarUrl", String(255), nullable=True)

class Chat(Base):
    __tablename__ = "Chats"

    id = Column("Id", Integer, primary_key=True, index=True)
    title = Column("title", String(100), nullable=True)
    type = Column("type", String(20), nullable=False)
    owner_id = Column("owner_id", Integer, ForeignKey("Users.Id"))


class ChatMember(Base):
    __tablename__ = "ChatMembers"

    id = Column("Id", Integer, primary_key=True, index=True)
    chat_id = Column("ChatId", Integer, ForeignKey("Chats.Id"))
    user_id = Column("UserId", Integer, ForeignKey("Users.Id"))
    joined_at = Column("JoinedAt", DateTime)
    role = Column("role", String(20))


class Message(Base):
    __tablename__ = "Messages"

    id = Column("id", Integer, primary_key=True, index=True)
    chat_id = Column("chat_id", Integer, ForeignKey("Chats.Id"))
    user_id = Column("user_id", Integer, ForeignKey("Users.Id"))
    text = Column("text", UnicodeText)
    image_url = Column("image_url", UnicodeText)
    created_at = Column("created_at", DateTime)

    reply_to = Column(Integer, nullable=True)
    reply_preview = Column(String, nullable=True)
    reply_from = Column(String, nullable=True)

    forwarded_from = Column(String, nullable=True)
    forwarded_message_id = Column(Integer, nullable=True)




class MessageReads(Base):
    __tablename__ = "MessageReads"

    id = Column("Id", Integer, primary_key=True, index=True)
    message_id = Column("MessageId", Integer, ForeignKey("Messages.id"))
    user_id = Column("UserId", Integer, ForeignKey("Users.Id"))
    read_at = Column("ReadAt", DateTime, default=datetime.utcnow)


class UserContact(Base):
    __tablename__ = "UserContacts"

    id = Column("Id", Integer, primary_key=True, index=True)
    user_id = Column("UserId", Integer, ForeignKey("Users.Id"), nullable=False)
    contact_id = Column("ContactId", Integer, ForeignKey("Users.Id"), nullable=False)


Base.metadata.create_all(bind=engine)

# =========================
# SCHEMAS
# =========================

class UserCreate(BaseModel):
    username: str
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ChatCreate(BaseModel):
    title: Optional[str] = None
    member_ids: List[int] = []


class MessageOut(BaseModel):
    id: int
    chat_id: int
    user_id: int
    text: Optional[str] = None
    image_url: Optional[str] = None
    created_at: datetime

    # ОТВЕТ
    reply_to: Optional[int] = None
    reply_preview: Optional[str] = None
    reply_from: Optional[str] = None

    # ПЕРЕСЫЛКА
    forwarded_from: Optional[str] = None
    forwarded_message_id: Optional[int] = None

    class Config:
        from_attributes = True




# =========================
# UTILS
# =========================

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def verify_password(plain, hashed):
    return pwd_context.verify(plain, hashed)


def hash_password(password):
    return pwd_context.hash(password)


def create_access_token(data: dict):
    to_encode = data.copy()
    to_encode["sub"] = str(to_encode["sub"])
    expire = datetime.utcnow() + timedelta(hours=24)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


# =========================
# / передача статики
# =========================
@app.get("/")
def root():
    return FileResponse("static/index.html")

# =========================
# /uploads/{filename}
# =========================
@app.get("/uploads/{filename}")
async def get_uploaded_file(filename: str):
    file_path = os.path.join(UPLOAD_DIR, filename)

    if not os.path.exists(file_path):
        return JSONResponse({"error": "file not found"}, status_code=404)

    return FileResponse(
        file_path,
        media_type="application/octet-stream",
        filename=filename,
    )





# =========================
# AUTH
# =========================

async def get_token_header(authorization: str = Header(...)):
    try:
        scheme, token = authorization.split()
        if scheme.lower() != "bearer":
            raise ValueError
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid auth header")
    return token


def get_current_user(token: str = Depends(get_token_header), db: Session = Depends(get_db)) -> User:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload.get("sub"))
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token payload")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


@app.post("/register", response_model=Token)
def register(user_in: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.username == user_in.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already taken")

    user = User(
        username=user_in.username,
        password_hash=hash_password(user_in.password)
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token({"sub": user.id})
    return Token(access_token=token)


@app.post("/login", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(status_code=400, detail="Incorrect username or password")

    token = create_access_token({"sub": user.id})
    return Token(access_token=token)


# =========================
# CHAT ROUTES
# =========================

@app.post("/chats")
def create_group_chat(
    chat_in: ChatCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    chat = Chat(
        title=chat_in.title or "Новая группа",
        type="group",
        owner_id=current_user.id
    )
    db.add(chat)
    db.commit()
    db.refresh(chat)

    creator = ChatMember(
        chat_id=chat.id,
        user_id=current_user.id,
        joined_at=datetime.utcnow(),
        role="admin"
    )
    db.add(creator)
    db.commit()

    return {
        "id": chat.id,
        "title": chat.title,
        "type": "group"
    }


@app.post("/chats/private")
def create_private_chat(
    other_user_id: int = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if other_user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Нельзя создать личный чат с самим собой")

    title = f"pm:{min(current_user.id, other_user_id)}:{max(current_user.id, other_user_id)}"

    existing = db.query(Chat).filter(Chat.title == title).first()
    if existing:
        # гарантируем, что оба пользователя являются участниками чата
        for uid in (current_user.id, other_user_id):
            member = db.query(ChatMember).filter(
                ChatMember.chat_id == existing.id,
                ChatMember.user_id == uid
            ).first()
            if not member:
                db.add(ChatMember(
                    chat_id=existing.id,
                    user_id=uid,
                    joined_at=datetime.utcnow(),
                    role="member"
                ))
        db.commit()

        other_user = db.query(User).filter(User.id == other_user_id).first()
        return {
            "id": existing.id,
            "title": other_user.username,
            "type": "private"
        }

    chat = Chat(
        title=title,
        type="private",
        owner_id=None
    )
    db.add(chat)
    db.commit()
    db.refresh(chat)

    db.add(ChatMember(
        chat_id=chat.id,
        user_id=current_user.id,
        joined_at=datetime.utcnow(),
        role="member"
    ))
    db.add(ChatMember(
        chat_id=chat.id,
        user_id=other_user_id,
        joined_at=datetime.utcnow(),
        role="member"
    ))
    db.commit()

    other_user = db.query(User).filter(User.id == other_user_id).first()

    return {
        "id": chat.id,
        "title": other_user.username,
        "type": "private"
    }

# =========================
# Avatar
# =========================
@app.post("/me/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    filename = f"avatar_{current_user.id}_{datetime.utcnow().timestamp()}.png"
    file_path = os.path.join(UPLOAD_DIR, filename)

    with open(file_path, "wb") as f:
        f.write(await file.read())

    current_user.avatar_url = f"/uploads/{filename}"
    db.commit()

    return {"avatar_url": current_user.avatar_url}




# =========================
# FILE UPLOAD
# =========================

@app.post("/upload")
async def upload_file(file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    filename = f"{datetime.utcnow().timestamp()}_{file.filename}"
    file_path = os.path.join(UPLOAD_DIR, filename)

    print("Saving to:", file_path)

    with open(file_path, "wb") as f:
        content = await file.read()
        f.write(content)

    url = f"/uploads/{filename}"

    return {
        "url": url,
        "filename": filename,
        "content_type": file.content_type,
        "size": len(content),
    }



# =========================
# LIST CHATS & MESSAGES
# =========================

@app.get("/chats")
def list_user_chats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    chat_ids = db.query(ChatMember.chat_id).filter(ChatMember.user_id == current_user.id)
    chats = db.query(Chat).filter(Chat.id.in_(chat_ids)).all()

    result = []

    for c in chats:

        # PRIVATE CHAT
        if c.type == "private":
            other_member = db.query(ChatMember).filter(
                ChatMember.chat_id == c.id,
                ChatMember.user_id != current_user.id
            ).first()

            if other_member:
                other_user = db.query(User).filter(User.id == other_member.user_id).first()
                title = other_user.username if other_user else c.title
                avatar = other_user.avatar_url if other_user else None
                other_user_id = other_user.id if other_user else None
            else:
                title = c.title
                avatar = None
                other_user_id = None

        # GROUP CHAT
        else:
            title = c.title
            avatar = None
            other_user_id = None

        # UNREAD COUNT
        unread = db.query(Message).filter(
            Message.chat_id == c.id,
            Message.id.notin_(
                db.query(MessageReads.message_id).filter(
                    MessageReads.user_id == current_user.id
                )
            )
        ).count()

        # MEMBERS (ВАЖНО!)
        members = (
            db.query(User)
            .join(ChatMember, ChatMember.user_id == User.id)
            .filter(ChatMember.chat_id == c.id)
            .all()
        )

        # ADD CHAT TO RESULT
        result.append({
            "id": c.id,
            "title": title,
            "type": c.type,
            "avatar_url": avatar,
            "other_user_id": other_user_id,
            "unread": unread,
            "members": [
                {"id": m.id, "username": m.username}
                for m in members
            ]
        })

    return result


@app.get("/chats/{chat_id}/messages", response_model=List[MessageOut])
def get_messages(
    chat_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    member = db.query(ChatMember).filter(
        ChatMember.chat_id == chat_id,
        ChatMember.user_id == current_user.id
    ).first()

    if not member:
        raise HTTPException(status_code=403, detail="Not a chat member")

    msgs = (
        db.query(Message)
        .filter(Message.chat_id == chat_id)
        .order_by(Message.created_at.asc())
        .all()
    )

    return msgs

# =========================
# endpoint для Непрочитанных
# =========================

@app.post("/chats/{chat_id}/read")
def mark_chat_read(
    chat_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    msgs = db.query(Message).filter(Message.chat_id == chat_id).all()

    for m in msgs:
        exists = db.query(MessageReads).filter(
            MessageReads.message_id == m.id,
            MessageReads.user_id == current_user.id
        ).first()

        if not exists:
            db.add(MessageReads(message_id=m.id, user_id=current_user.id))

    db.commit()
    return {"status": "ok"}

# =========================
# endpoint Добавить участников
# =========================
class AddMember(BaseModel):
    user_id: int

@app.post("/chats/{chat_id}/add_member")
def add_member(
    chat_id: int,
    payload: AddMember,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    user_id = payload.user_id

    chat = db.query(Chat).filter(Chat.id == chat_id).first()
    if not chat:
        raise HTTPException(404, "Chat not found")

    # Проверяем, что участник уже есть
    exists = db.query(ChatMember).filter(
        ChatMember.chat_id == chat_id,
        ChatMember.user_id == user_id
    ).first()

    if exists:
        return {"status": "already_member"}

    # Добавляем участника с ролью member
    new_member = ChatMember(
        chat_id=chat_id,
        user_id=user_id,
        joined_at=datetime.utcnow(),
        role="member"
    )

    db.add(new_member)
    db.commit()

    return {"status": "ok"}



# =========================
# endpoint Покинуть чат
# =========================

@app.post("/chats/{chat_id}/leave")
def leave_chat(chat_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    member = db.query(ChatMember).filter(
        ChatMember.chat_id == chat_id,
        ChatMember.user_id == current_user.id
    ).first()

    if not member:
        raise HTTPException(404, "You are not in this chat")

    db.delete(member)
    db.commit()

    return {"status": "left"}


# =========================
# endpoint Удалить чат
# =========================

@app.delete("/chats/{chat_id}")
def delete_chat(chat_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    chat = db.query(Chat).filter(Chat.id == chat_id).first()
    if not chat:
        raise HTTPException(404, "Chat not found")

    if chat.owner_id != current_user.id:
        raise HTTPException(403, "Not allowed")

    db.query(ChatMember).filter(ChatMember.chat_id == chat_id).delete()
    db.delete(chat)
    db.commit()

    return {"status": "deleted"}



# =========================
# endpoint users
# =========================
@app.get("/users")
def get_users(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    users = db.query(User).all()
    return [
        {
            "id": u.id,
            "username": u.username,
            "avatar": u.avatar_url if hasattr(u, "avatar_url") else None
        }
        for u in users
    ]



# =========================
# endpoint Список статусов
# =========================
@app.get("/users/status")
def get_all_statuses(db: Session = Depends(get_db)):
    users = db.query(User).all()
    return {u.id: u.status for u in users}





@app.put("/messages/{message_id}")
async def edit_message(
    message_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    new_text = payload.get("text")
    if not new_text:
        raise HTTPException(status_code=400, detail="Text required")

    msg = db.query(Message).filter(Message.id == message_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    # Проверяем роль пользователя в чате
    member = db.query(ChatMember).filter(
        ChatMember.chat_id == msg.chat_id,
        ChatMember.user_id == current_user.id
    ).first()

    if member.role != "admin" and msg.user_id != current_user.id:
        raise HTTPException(403, "Forbidden")

    msg.text = new_text
    db.commit()
    db.refresh(msg)

    await ws_manager.broadcast(msg.chat_id, {
        "type": "edit",
        "id": msg.id,
        "text": msg.text
    })

    return {"status": "ok"}




@app.post("/messages/{message_id}/forward")
async def forward_message(
    message_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    target_chat_id = payload.get("target_chat_id")
    if not target_chat_id:
        raise HTTPException(status_code=400, detail="target_chat_id required")

    orig = db.query(Message).filter(Message.id == message_id).first()
    if not orig:
        raise HTTPException(status_code=404, detail="Message not found")

    sender = db.query(User).filter(User.id == orig.user_id).first()

    new_msg = Message(
        chat_id=target_chat_id,
        user_id=current_user.id,
        text=orig.text,
        image_url=orig.image_url,
        forwarded_from=sender.username,
        forwarded_message_id=orig.id,
        created_at=datetime.utcnow()
    )

    db.add(new_msg)
    db.commit()
    db.refresh(new_msg)

    out = {
        "id": new_msg.id,
        "chat_id": new_msg.chat_id,
        "user_id": new_msg.user_id,
        "text": new_msg.text,
        "image_url": new_msg.image_url,
        "forwarded_from": new_msg.forwarded_from,
        "forwarded_message_id": new_msg.forwarded_message_id,
        "created_at": new_msg.created_at.isoformat(),
        "username": current_user.username,
    }

    # ВАЖНО: теперь можно await
    await ws_manager.broadcast(target_chat_id, out)

    return {"status": "ok", "message": out}

#=====================
# Delete message
#=====================
@app.post("/delete_messages")
def delete_messages(payload: dict,
                    db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user)):

    ids = payload.get("ids", [])
    chat_id = payload.get("chat_id")

    if not ids or not chat_id:
        raise HTTPException(400, "ids and chat_id required")

    # Проверяем, что пользователь в чате
    member = db.query(ChatMember).filter(
        ChatMember.chat_id == chat_id,
        ChatMember.user_id == current_user.id
    ).first()

    if not member:
        raise HTTPException(403, "Not allowed")

    # Удаляем только свои сообщения или если admin
    for mid in ids:
        msg = db.query(Message).filter(Message.id == mid).first()
        if not msg:
            continue

        if msg.user_id != current_user.id and member.role != "admin":
            continue

        db.delete(msg)

    db.commit()
    return {"status": "ok", "deleted": len(ids)}

#=========================
#/messages/forward_many
#=========================
@app.post("/messages/forward_many")
async def forward_many(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    ids = payload.get("message_ids", [])
    target_chat_id = payload.get("target_chat_id")

    if not ids or not target_chat_id:
        raise HTTPException(400, "message_ids and target_chat_id required")

    new_messages = []

    for mid in ids:
        orig = db.query(Message).filter(Message.id == mid).first()
        if not orig:
            continue

        sender = db.query(User).filter(User.id == orig.user_id).first()

        new_msg = Message(
            chat_id=target_chat_id,
            user_id=current_user.id,
            text=orig.text,
            image_url=orig.image_url,
            forwarded_from=sender.username,
            forwarded_message_id=orig.id,
            created_at=datetime.utcnow()
        )

        db.add(new_msg)
        db.commit()
        db.refresh(new_msg)

        new_messages.append(new_msg)

        # ВАЖНО: теперь await
        await ws_manager.broadcast(target_chat_id, {
            "id": new_msg.id,
            "chat_id": new_msg.chat_id,
            "user_id": new_msg.user_id,
            "text": new_msg.text,
            "image_url": new_msg.image_url,
            "forwarded_from": new_msg.forwarded_from,
            "forwarded_message_id": new_msg.forwarded_message_id,
            "created_at": new_msg.created_at.isoformat(),
            "username": current_user.username,
        })

    return {"status": "ok", "count": len(new_messages)}


# =========================
# ws_auth
# =========================
async def ws_auth(websocket: WebSocket, db: Session) -> User:
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4401)
        raise WebSocketDisconnect

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload.get("sub"))
        if user_id is None:
            await websocket.close(code=4401)
            raise WebSocketDisconnect
    except JWTError:
        await websocket.close(code=4401)
        raise WebSocketDisconnect

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        await websocket.close(code=4401)
        raise WebSocketDisconnect

    return user

# =========================
# ConnectionManager
# =========================
class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[int, list[WebSocket]] = {}

    async def connect(self, chat_id: int, websocket: WebSocket):
        await websocket.accept()
        if chat_id not in self.active_connections:
            self.active_connections[chat_id] = []
        self.active_connections[chat_id].append(websocket)

    def disconnect(self, chat_id: int, websocket: WebSocket):
        if chat_id in self.active_connections:
            if websocket in self.active_connections[chat_id]:
                self.active_connections[chat_id].remove(websocket)

    async def broadcast(self, chat_id: int, message: dict):
        if chat_id in self.active_connections:
            dead = []
            for ws in self.active_connections[chat_id]:
                try:
                    await ws.send_json(message)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                self.active_connections[chat_id].remove(ws)

# =========================
# ws_manager
# =========================

ws_manager = ConnectionManager()

# =========================
# chat_ws
# =========================

@app.websocket("/ws/chat/{chat_id}")
async def chat_ws(websocket: WebSocket, chat_id: int):
    db = SessionLocal()
    user = await ws_auth(websocket, db)
    await ws_manager.connect(chat_id, websocket)

    try:
        while True:
            data = await websocket.receive_json()

            # =========================
            # TYPING
            # =========================
            if "typing" in data:
                await ws_manager.broadcast(chat_id, {
                    "typing": data["typing"],
                    "user_id": user.id
                })
                continue

            # =========================
            # FILE MESSAGE
            # =========================
            if data.get("file_url"):
                file_url = data["file_url"]
                file_name = data.get("file_name")
                file_type = data.get("file_type")

                msg = Message(
                    chat_id=chat_id,
                    user_id=user.id,
                    text=file_name,
                    image_url=file_url,
                    created_at=datetime.utcnow()
                )

                db.add(msg)
                db.commit()
                db.refresh(msg)

                out = {
                    "id": msg.id,
                    "chat_id": msg.chat_id,
                    "user_id": msg.user_id,
                    "text": msg.text,
                    "image_url": msg.image_url,
                    "file_type": file_type,

                    "reply_to": msg.reply_to,
                    "reply_preview": msg.reply_preview,
                    "reply_from": msg.reply_from,

                    "forwarded_from": msg.forwarded_from,
                    "forwarded_message_id": msg.forwarded_message_id,

                    "created_at": msg.created_at.isoformat(),
                    "username": user.username,
                }

                await ws_manager.broadcast(chat_id, out)
                continue

            # =========================
            # TEXT MESSAGE
            # =========================
            text = data.get("text", "")
            if not text and not data.get("forward_from"):
                continue  # защита от пустых сообщений

            msg = Message(
                chat_id=chat_id,
                user_id=user.id,
                text=text,
                created_at=datetime.utcnow()
            )

            # ====== ОТВЕТ ======
            if data.get("reply_to"):
                msg.reply_to = data["reply_to"]
                msg.reply_preview = data.get("reply_preview")
                msg.reply_from = data.get("reply_from")

            # ====== ПЕРЕСЫЛКА ======
            if data.get("forward_from"):
                orig = db.query(Message).filter(Message.id == data["forward_from"]).first()
                if orig:
                    sender = db.query(User).filter(User.id == orig.user_id).first()

                    msg.forwarded_from = sender.username
                    msg.forwarded_message_id = orig.id
                    msg.image_url = orig.image_url
                    msg.text = orig.text

            db.add(msg)
            db.commit()
            db.refresh(msg)

            out = {
                "id": msg.id,
                "chat_id": msg.chat_id,
                "user_id": msg.user_id,
                "text": msg.text,
                "image_url": msg.image_url,

                "reply_to": msg.reply_to,
                "reply_preview": msg.reply_preview,
                "reply_from": msg.reply_from,

                "forwarded_from": msg.forwarded_from,
                "forwarded_message_id": msg.forwarded_message_id,

                "created_at": msg.created_at.isoformat(),
                "username": user.username,
            }

            await ws_manager.broadcast(chat_id, out)

    except WebSocketDisconnect:
        ws_manager.disconnect(chat_id, websocket)
        db.close()


# =========================
# USER INFO
# =========================

@app.get("/me")
def me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "username": current_user.username,
        "status": getattr(current_user, "status", "online"),
        "avatar_url": getattr(current_user, "avatar_url", None)
    }



@app.get("/users/search")
def search_users(q: str, db: Session = Depends(get_db)):
    users = db.query(User).filter(User.username.contains(q)).all()
    return [{"id": u.id, "username": u.username} for u in users]

# =========================
# USER settings
# =========================

from pydantic import BaseModel

class ProfileUpdate(BaseModel):
    username: Optional[str] = None
    status: Optional[str] = None  # online, offline, invisible


@app.put("/me/update")
def update_profile(
    payload: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if payload.username:
        exists = db.query(User).filter(
            User.username == payload.username,
            User.id != current_user.id
        ).first()
        if exists:
            raise HTTPException(status_code=400, detail="Username already taken")

        current_user.username = payload.username

    if payload.status:
        current_user.status = payload.status

    db.commit()
    db.refresh(current_user)

    return {
        "id": current_user.id,
        "username": current_user.username,
        "status": current_user.status,
        "avatar_url": current_user.avatar_url
    }




# =========================
# UNIFIED SEARCH (users + groups)
# =========================

@app.get("/search")
def unified_search(
    q: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    results = []

    users = db.query(User).filter(User.username.contains(q)).all()
    for u in users:
        results.append({
            "type": "user",
            "id": u.id,
            "username": u.username
        })

    groups = db.query(Chat).filter(
        Chat.type == "group",
        Chat.title.contains(q)
    ).all()

    for g in groups:
        results.append({
            "type": "group",
            "id": g.id,
            "title": g.title
        })

    return results

@app.post("/forward")
def forward_messages(payload: dict, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    target_chat = payload["chat_id"]
    messages = payload["messages"]  # список ID сообщений

    out_messages = []

    for mid in messages:
        orig = db.query(Message).filter(Message.id == mid).first()
        if not orig:
            continue

        sender = db.query(User).filter(User.id == orig.user_id).first()

        msg = Message(
            chat_id=target_chat,
            user_id=user.id,
            text=orig.text,
            image_url=orig.image_url,
            forwarded_from=sender.username,
            forwarded_message_id=orig.id,
            created_at=datetime.utcnow()
        )

        db.add(msg)
        db.commit()
        db.refresh(msg)

        out_messages.append(msg.id)

        # рассылаем в WebSocket чата
        asyncio.create_task(ws_manager.broadcast(target_chat, {
            "id": msg.id,
            "chat_id": msg.chat_id,
            "user_id": msg.user_id,
            "text": msg.text,
            "image_url": msg.image_url,
            "forwarded_from": msg.forwarded_from,
            "forwarded_message_id": msg.forwarded_message_id,
            "created_at": msg.created_at.isoformat(),
            "username": user.username,
        }))

    return {"status": "ok", "messages": out_messages}

@app.delete("/message/{msg_id}")
async def delete_message(msg_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    msg = db.query(Message).filter(Message.id == msg_id).first()
    if not msg:
        return {"error": "not found"}

    chat_id = msg.chat_id

    db.delete(msg)
    db.commit()

    # уведомляем WebSocket
    asyncio.create_task(ws_manager.broadcast(chat_id, {
        "deleted_id": msg_id
    }))

    return {"status": "ok"}

# =========================
# ENTRYPOINT
# =========================

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

