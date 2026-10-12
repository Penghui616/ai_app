from pathlib import Path
from getpass import getpass

def main():
    target=Path(__file__).parent/".env"
    print("请先确认公司授权的开发库与专用账号。本工具只保存配置，不连接或建库。")
    if target.exists():
        print("backend/.env 已存在，为避免覆盖，请直接编辑该文件。");return
    host=input("MySQL 主机地址：").strip()
    port=input("端口 [3306]：").strip() or "3306"
    database=input("公司确认的数据库名 [vision_lab_dev]：").strip() or "vision_lab_dev"
    user=input("项目账号：").strip()
    password=getpass("密码（输入不显示）：")
    ca=input("TLS CA 证书路径（如有）：").strip()
    if not host or not user or not password or not port.isdigit() or not 0<int(port)<65536:raise SystemExit("配置不完整，未保存。")
    def quote(value):return "'"+value.replace(chr(92),chr(92)*2).replace("'",chr(92)+"'")+"'"
    values=dict(MYSQL_HOST=host,MYSQL_PORT=port,MYSQL_DATABASE=database,MYSQL_USER=user,MYSQL_PASSWORD=password,MYSQL_SSL_CA=ca)
    if any(chr(10) in v or chr(13) in v for v in values.values()):raise SystemExit("配置不能包含换行。")
    target.write_text(chr(10).join(k+"="+quote(v) for k,v in values.items())+chr(10),encoding="utf-8")
    print("已保存至 backend/.env，未连接数据库。确认授权后重新启动后端。")
if __name__=="__main__":main()
