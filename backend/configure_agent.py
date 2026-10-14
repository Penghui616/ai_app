"""Interactive local-only configuration; no network request or database write."""
from getpass import getpass
from pathlib import Path
from backend.agent_provider import valid_base


def main():
    target = Path(__file__).parent / ".env.agent"
    print("配置阿里云百炼中国内地接口。密钥只保存在本机，不上传图片。")
    print("请从百炼控制台复制 OpenAI 兼容 Base URL（以 /compatible-mode/v1 结尾）。")
    print("例如业务空间地址：https://你的业务空间ID.cn-beijing.maas.aliyuncs.com/compatible-mode/v1")
    print("如控制台提供旧版地址，也可填 https://dashscope.aliyuncs.com/compatible-mode/v1")
    if target.exists():
        print("backend/.env.agent 已存在，为避免覆盖请直接编辑该文件。")
        return
    base = input("Base URL：").strip().rstrip("/")
    model = input("模型 [qwen3.8-max]：").strip() or "qwen3.8-max"
    key = getpass("百炼 API Key（输入不显示）：").strip()
    if not key or not valid_base(base) or any(c in base+model+key for c in "\r\n"):
        raise SystemExit("配置不完整或不是受支持的百炼中国内地 HTTPS 地址，未保存。")
    def quote(v):
        return "'"+v.replace("\\", "\\\\").replace("'", "\\'")+"'"
    target.write_text("\n".join(k+"="+quote(v) for k,v in dict(AGENT_BASE_URL=base, AGENT_MODEL=model, DASHSCOPE_API_KEY=key).items())+"\n", encoding="utf-8")
    print("已保存 backend/.env.agent。重启后端后，在助手面板点击重新加载。此工具未调用模型或连接数据库。")


if __name__ == "__main__":
    main()
