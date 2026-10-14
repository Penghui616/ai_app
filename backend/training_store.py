"""Persistence for the single-process teaching prototype. No silent DB fallback."""
import os
from pathlib import Path
from datetime import datetime, timezone
from uuid import uuid4
from copy import deepcopy
from sqlalchemy import create_engine, String, JSON, select, URL
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env", interpolate=False)
DATA_DIR = Path(os.getenv("VISION_DATA_DIR", Path(__file__).parent / "data"))
COLORS = ["#5d8bf4","#eba34f","#8c79d8","#42ad98","#d478a2","#51a5cc","#a49a54","#a67a69"]
DEFAULT_PARAMS = dict(imageSize=224,batchSize=16,epochs=30,optimizer="AdamW",learningRate=.001)
def now(): return datetime.now(timezone.utc).isoformat()
def uid(): return str(uuid4())
class Base(DeclarativeBase): pass
class ProjectRow(Base):
    __tablename__ = "vl_projects"
    id: Mapped[str] = mapped_column(String(36),primary_key=True)
    owner: Mapped[str] = mapped_column(String(64),index=True)
    document: Mapped[dict] = mapped_column(JSON)
class RunRow(Base):
    __tablename__ = "vl_training_runs"
    id: Mapped[str] = mapped_column(String(36),primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36),index=True)
    document: Mapped[dict] = mapped_column(JSON)

class Store:
    def __init__(self,url=None):
        self.engine=None
        if url is False:return
        if url is None:
            if not os.getenv("MYSQL_DATABASE") or not os.getenv("MYSQL_USER"): return
            url=URL.create("mysql+pymysql",username=os.environ["MYSQL_USER"],password=os.getenv("MYSQL_PASSWORD",""),host=os.getenv("MYSQL_HOST","127.0.0.1"),port=int(os.getenv("MYSQL_PORT","3306")),database=os.environ["MYSQL_DATABASE"],query={"charset":"utf8mb4"})
        kwargs={"pool_pre_ping":True}
        if str(url).startswith("sqlite"):
            kwargs["connect_args"]={"check_same_thread":False}
        else:
            kwargs["connect_args"]={"connect_timeout":5,"read_timeout":10,"write_timeout":10}
            if os.getenv("MYSQL_SSL_CA"): kwargs["connect_args"]["ssl"]={"ca":os.environ["MYSQL_SSL_CA"],"check_hostname":True}
        self.engine=create_engine(url,**kwargs)
        self.session=sessionmaker(self.engine,expire_on_commit=False)
    def initialize(self):
        if self.engine is None: raise RuntimeError("请在 backend/.env 配置独立开发库的 MySQL 连接信息。")
        Base.metadata.create_all(self.engine)
        with self.session.begin() as s:
            for row in s.scalars(select(RunRow)):
                d=deepcopy(row.document)
                if d["status"]=="running":
                    d.update(status="failed",finishedAt=now(),message="服务重启中断了训练，请重新开始。",stage="failed")
                    row.document=d
    def list(self,owner):
        with self.session() as s:
            return [self._project(s,r) for r in s.scalars(select(ProjectRow).where(ProjectRow.owner==owner))]
    def _project(self,s,row):
        d=deepcopy(row.document)
        d["runs"]=sorted([deepcopy(r.document) for r in s.scalars(select(RunRow).where(RunRow.project_id==row.id))],key=lambda r:r["startedAt"],reverse=True)
        return d
    def get(self,owner,id):
        with self.session() as s:
            row=s.get(ProjectRow,id)
            if row is None or row.owner!=owner: return None
            return self._project(s,row)
    def save(self,owner,d):
        value=deepcopy(d);value.pop("runs",None)
        with self.session.begin() as s:
            row=s.get(ProjectRow,d["id"])
            if row is None:s.add(ProjectRow(id=d["id"],owner=owner,document=value))
            else:
                if row.owner!=owner: raise ValueError("Project owner mismatch")
                row.document=value
    def save_run(self,run):
        with self.session.begin() as s:
            row=s.get(RunRow,run["id"])
            if row is None:s.add(RunRow(id=run["id"],project_id=run["projectId"],document=deepcopy(run)))
            else:row.document=deepcopy(run)
    def delete(self,owner,id):
        with self.session.begin() as s:
            row=s.get(ProjectRow,id)
            if row is None or row.owner!=owner: return
            for run in s.scalars(select(RunRow).where(RunRow.project_id==id)):s.delete(run)
            if getattr(self,"agent_cleanup",None):self.agent_cleanup(s,owner,id)
            s.delete(row)
