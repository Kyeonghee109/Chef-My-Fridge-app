"""함수 호출 입력·출력·지연·토큰과 중첩 호출 트리를 기록하는 추적 유틸리티."""
from __future__ import annotations

import contextvars
import functools
import inspect
import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable, TypeVar, cast


LOGGER = logging.getLogger("rag.trace")
F = TypeVar("F", bound=Callable[..., Any])
_CURRENT_NODE: contextvars.ContextVar["TraceNode | None"] = contextvars.ContextVar("trace_current", default=None)
_ROOT_NODE: contextvars.ContextVar["TraceNode | None"] = contextvars.ContextVar("trace_root", default=None)
_SENSITIVE_KEY = re.compile(r"(?:api[_-]?key|token|secret|password|authorization|cookie)", re.I)
_MAX_TEXT = 500


@dataclass
class TraceNode:
    """하나의 함수 호출과 자식 호출을 표현하는 노드입니다."""

    name: str
    input: Any
    parent: "TraceNode | None" = None
    children: list["TraceNode"] = field(default_factory=list)
    output: Any = None
    error: str | None = None
    duration_ms: float = 0.0
    tokens: dict[str, int] = field(default_factory=dict)


def _safe(value: Any, key: str | None = None) -> Any:
    """로그에 남길 값을 JSON 안전하고 짧게 마스킹·축약합니다."""
    if key and _SENSITIVE_KEY.search(key):
        return "[REDACTED]"
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return value if len(value) <= _MAX_TEXT else f"{value[:_MAX_TEXT]}…"
    if isinstance(value, dict):
        return {str(k): _safe(v, str(k)) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_safe(item) for item in list(value)[:20]]
    if hasattr(value, "model_dump"):
        return _safe(value.model_dump())
    if hasattr(value, "dict") and callable(value.dict):
        return _safe(value.dict())
    return _safe(str(value))


def _tokens(value: Any) -> dict[str, int]:
    """LangChain/OpenAI/Anthropic 응답에서 토큰 사용량을 찾아 표준화합니다."""
    candidates: list[Any] = []
    if isinstance(value, dict):
        candidates.extend([value.get("usage"), value.get("usage_metadata"), value.get("response_metadata")])
        candidates.append(value)
    else:
        for attr in ("usage_metadata", "response_metadata", "usage"):
            candidates.append(getattr(value, attr, None))
    result: dict[str, int] = {}
    aliases = {
        "input_tokens": "input",
        "prompt_tokens": "input",
        "input_token_count": "input",
        "output_tokens": "output",
        "completion_tokens": "output",
        "output_token_count": "output",
        "total_tokens": "total",
    }
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        for source, target in aliases.items():
            amount = candidate.get(source)
            if isinstance(amount, (int, float)):
                result[target] = int(amount)
    if "total" not in result and {"input", "output"}.issubset(result):
        result["total"] = result["input"] + result["output"]
    return result


def token_usage(value: Any) -> dict[str, int]:
    """LLM 응답에서 입력·출력·전체 토큰 사용량을 추출합니다."""
    return _tokens(value)


def _format_node(node: TraceNode, depth: int = 0) -> str:
    indent = "  " * depth
    details = {
        "in": _safe(node.input),
        "out": _safe(node.output),
        "ms": round(node.duration_ms, 2),
        "tokens": node.tokens or {},
    }
    if node.error:
        details["error"] = node.error
    line = f"{indent}└─ {node.name} {json.dumps(details, ensure_ascii=False, default=str)}"
    return "\n".join([line, *(_format_node(child, depth + 1) for child in node.children)])


def _print_root(node: TraceNode) -> None:
    LOGGER.info("@trace 호출 트리\n%s", _format_node(node))


def trace(func: F) -> F:
    """함수에 `@trace`를 붙여 입력·출력·지연·토큰과 중첩 호출을 기록합니다."""

    def start_call(args: tuple[Any, ...], kwargs: dict[str, Any]) -> tuple[TraceNode, contextvars.Token, contextvars.Token | None, bool, float]:
        parent = _CURRENT_NODE.get()
        root = _ROOT_NODE.get()
        node = TraceNode(func.__qualname__, {"args": args, "kwargs": kwargs}, parent=parent)
        if parent:
            parent.children.append(node)
        is_root = root is None
        root_token = _ROOT_NODE.set(node) if is_root else None
        current_token = _CURRENT_NODE.set(node)
        return node, current_token, root_token, is_root, time.perf_counter()

    def finish_call(node: TraceNode, current_token: contextvars.Token, root_token: contextvars.Token | None, is_root: bool, started: float) -> None:
        node.duration_ms = (time.perf_counter() - started) * 1000
        _CURRENT_NODE.reset(current_token)
        if is_root:
            _print_root(node)
            if root_token:
                _ROOT_NODE.reset(root_token)

    if inspect.iscoroutinefunction(func):
        @functools.wraps(func)
        async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
            node, current_token, root_token, is_root, started = start_call(args, kwargs)
            try:
                result = await func(*args, **kwargs)
                node.output = result
                node.tokens = _tokens(result)
                return result
            except Exception as error:
                node.error = f"{type(error).__name__}: {error}"
                raise
            finally:
                finish_call(node, current_token, root_token, is_root, started)
        return cast(F, async_wrapper)

    @functools.wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        node, current_token, root_token, is_root, started = start_call(args, kwargs)
        try:
            result = func(*args, **kwargs)
            node.output = result
            node.tokens = _tokens(result)
            return result
        except Exception as error:
            node.error = f"{type(error).__name__}: {error}"
            raise
        finally:
            finish_call(node, current_token, root_token, is_root, started)

    return cast(F, wrapper)


__all__ = ["trace", "token_usage", "TraceNode"]
