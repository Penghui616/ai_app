"""Assistant data, separate from experiment documents; no images or secrets."""
from copy import deepcopy
from sqlalchemy import String, JSON, select, delete
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from fastapi import HTTPException
from backend.training_store import uid, now


class AgentBase(DeclarativeBase):
    pass


class ThreadRow(AgentBase):
    __tablename__ = "vl_agent_threads"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), index=True)
    owner: Mapped[str] = mapped_column(String(64), index=True)
    document: Mapped[dict] = mapped_column(JSON)


class MemoryRow(AgentBase):
    __tablename__ = "vl_agent_notes"
    project_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner: Mapped[str] = mapped_column(String(64))
    document: Mapped[dict] = mapped_column(JSON)


class AgentStore:
    def __init__(self, store):
        self.store = store
        self.ready = False

    def initialize(self):
        engine = self.store.engine
        if engine is None:
            return
        if engine.dialect.name != "sqlite" and engine.url.database != "vision_lab_dev":
            raise RuntimeError("助手目前仅允许使用已授权的 vision_lab_dev 数据库。")
        AgentBase.metadata.create_all(engine)
        self.ready = True
        self.store.agent_cleanup = self.cleanup

    def check(self):
        if not self.ready:
            raise HTTPException(503, "助手存储尚未就绪，请检查后端数据库连接。")

    def cleanup(self, session, owner, pid):
        session.execute(delete(ThreadRow).where(ThreadRow.project_id == pid, ThreadRow.owner == owner))
        session.execute(delete(MemoryRow).where(MemoryRow.project_id == pid, MemoryRow.owner == owner))

    def threads(self, owner, pid):
        self.check()
        with self.store.session() as s:
            rows = s.scalars(select(ThreadRow).where(ThreadRow.project_id == pid, ThreadRow.owner == owner))
            result = [deepcopy(r.document) for r in rows]
        return sorted(result, key=lambda d: d["updatedAt"], reverse=True)

    def create(self, owner, pid, mode):
        if len(self.threads(owner, pid)) >= 20:
            raise HTTPException(409, "每项目最多保存 20 个对话，请删除不需要的历史对话。")
        doc = dict(id=uid(), projectId=pid, title="新对话", mode=mode, createdAt=now(), updatedAt=now(), messages=[], historyDigest="")
        with self.store.session.begin() as s:
            s.add(ThreadRow(id=doc["id"], project_id=pid, owner=owner, document=doc))
        return doc

    def get(self, owner, pid, tid):
        self.check()
        with self.store.session() as s:
            row = s.get(ThreadRow, tid)
            if row is None or row.owner != owner or row.project_id != pid:
                raise HTTPException(404, "对话不存在或不属于当前项目。")
            return deepcopy(row.document)

    def save(self, owner, pid, doc):
        doc["updatedAt"] = now()
        with self.store.session.begin() as s:
            row = s.get(ThreadRow, doc["id"])
            if row is None or row.owner != owner or row.project_id != pid:
                raise HTTPException(404, "对话不存在。")
            row.document = deepcopy(doc)

    def remove(self, owner, pid, tid):
        self.get(owner, pid, tid)
        with self.store.session.begin() as s:
            s.execute(delete(ThreadRow).where(ThreadRow.id == tid, ThreadRow.owner == owner, ThreadRow.project_id == pid))

    def notes(self, owner, pid):
        self.check()
        with self.store.session() as s:
            row = s.get(MemoryRow, pid)
            if row and row.owner != owner:
                raise HTTPException(404, "项目笔记不存在。")
            return deepcopy(row.document.get("notes", [])) if row else []

    def save_notes(self, owner, pid, notes):
        with self.store.session.begin() as s:
            row = s.get(MemoryRow, pid)
            if row:
                if row.owner != owner:
                    raise HTTPException(404, "项目笔记不存在。")
                row.document = dict(notes=deepcopy(notes))
            else:
                s.add(MemoryRow(project_id=pid, owner=owner, document=dict(notes=deepcopy(notes))))
