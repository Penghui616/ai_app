"""Bailian Chat Completions adapter. Only text and allowlisted read tools leave the server."""
import os
import time
from pathlib import Path
from urllib.parse import urlparse
import httpx
from dotenv import dotenv_values


class ProviderError(Exception):
    pass


def valid_base(url):
    try:
        p = urlparse(url)
        host = p.hostname or ""
        port = p.port
    except (ValueError, TypeError):
        return False
    return (p.scheme == "https" and not p.username and not p.password and not p.query and not p.fragment
            and port in (None, 443) and p.path.rstrip("/") == "/compatible-mode/v1"
            and (host == "dashscope.aliyuncs.com" or host.endswith(".cn-beijing.maas.aliyuncs.com")))


class BailianProvider:
    def __init__(self):
        config = {**dotenv_values(Path(__file__).parent / ".env.agent", interpolate=False), **os.environ}
        self.model = config.get("AGENT_MODEL") or "qwen3.8-max"
        self.base_url = (config.get("AGENT_BASE_URL") or "").rstrip("/")
        self.key = config.get("DASHSCOPE_API_KEY") or ""
        self.ready = bool(self.key and valid_base(self.base_url))

    def complete(self, messages, tools, deadline):
        if not self.ready:
            raise ProviderError("尚未配置百炼 API，请运行项目中的‘配置实验助手.cmd’，填写接口地址和 API Key 后重启后端。")
        payload = dict(model=self.model, messages=messages, stream=False, temperature=0.3,
                       max_tokens=1600, enable_thinking=False)
        if tools:
            payload.update(tools=tools, tool_choice="auto")
        else:
            payload["tool_choice"] = "none"
        for attempt in range(2):
            remaining = deadline-time.monotonic()
            if remaining <= 1:
                raise ProviderError("助手请求超时，请稍后重试；训练任务不受影响。")
            try:
                with httpx.Client(timeout=min(35, remaining), follow_redirects=False) as client:
                    response = client.post(self.base_url+"/chat/completions", json=payload,
                                           headers={"Authorization": "Bearer "+self.key})
            except httpx.TimeoutException:
                raise ProviderError("百炼响应超时，请重试；本次问题未保存为已完成对话。") from None
            except httpx.HTTPError:
                raise ProviderError("无法连接百炼，请检查网络与接口地址。") from None
            if response.status_code in (429, 502, 503) and attempt == 0 and deadline-time.monotonic() > 3:
                time.sleep(1)
                continue
            if response.status_code in (401, 403):
                raise ProviderError("百炼鉴权失败，请检查 API Key、业务空间和模型授权。")
            if response.status_code >= 400:
                raise ProviderError(f"百炼调用失败（HTTP {response.status_code}），请检查模型名称、接口地址或额度；未使用演示回复替代。")
            try:
                data = response.json()
                message = data["choices"][0]["message"]
                if not isinstance(message, dict):
                    raise ValueError()
                return dict(message=message, usage=data.get("usage") or {}, requestId=response.headers.get("x-request-id"))
            except (ValueError, KeyError, IndexError, TypeError):
                raise ProviderError("百炼返回格式异常，请重试。") from None
