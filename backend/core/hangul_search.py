import re
from typing import Iterable, Optional, Tuple


HANGUL_BASE = 0xAC00
HANGUL_END = 0xD7A3
HANGUL_UNIT = 588
CHOSEONG = [
    "ㄱ",
    "ㄲ",
    "ㄴ",
    "ㄷ",
    "ㄸ",
    "ㄹ",
    "ㅁ",
    "ㅂ",
    "ㅃ",
    "ㅅ",
    "ㅆ",
    "ㅇ",
    "ㅈ",
    "ㅉ",
    "ㅊ",
    "ㅋ",
    "ㅌ",
    "ㅍ",
    "ㅎ",
]
CHOSEONG_SET = set(CHOSEONG)
TOKEN_PATTERN = re.compile(r"[0-9a-zA-Z가-힣ㄱ-ㅎㅏ-ㅣ]+")
WHITESPACE_PATTERN = re.compile(r"\s+")


def _is_hangul_syllable(char: str) -> bool:
    code = ord(char)
    return HANGUL_BASE <= code <= HANGUL_END


def _choseong_for_char(char: str) -> str:
    if _is_hangul_syllable(char):
        return CHOSEONG[(ord(char) - HANGUL_BASE) // HANGUL_UNIT]
    if char in CHOSEONG_SET:
        return char
    return ""


def get_choseong(text: str) -> str:
    return "".join(_choseong_for_char(char) for char in text)


def _ngrams(value: str, *, min_size: int = 2, max_size: int = 6) -> Iterable[str]:
    length = len(value)
    if length < min_size:
        return
    for size in range(min_size, min(max_size, length) + 1):
        for start in range(0, length - size + 1):
            yield value[start : start + size]


def build_search_text(value: object, *, max_extra_tokens: int = 600) -> str:
    """Build an FTS-friendly text that supports Korean substring and choseong search.

    SQLite FTS tokenizes Korean words as whole tokens, so a query like "회의" may
    not match the indexed word "회의록".  We keep the original text for ordinary
    search and add bounded character n-grams plus choseong n-grams as helper
    tokens.  Results still display the original chunk content.
    """

    original = WHITESPACE_PATTERN.sub(" ", str(value or "").strip()).lower()
    if not original:
        return ""

    extra_tokens: list[str] = []
    seen: set[str] = set()

    def add(token: str) -> None:
        if not token or token in seen or len(extra_tokens) >= max_extra_tokens:
            return
        seen.add(token)
        extra_tokens.append(token)

    for match in TOKEN_PATTERN.finditer(original):
        token = match.group(0)
        for ngram in _ngrams(token):
            add(ngram)

        choseong = get_choseong(token)
        if choseong:
            add(choseong)
            for ngram in _ngrams(choseong):
                add(ngram)

        if len(extra_tokens) >= max_extra_tokens:
            break

    return " ".join([original, *extra_tokens])


def build_trigram_search_text(value: object) -> str:
    """Build compact text for the FTS5 trigram fast path.

    The existing unicode61 index stores explicit Korean/choseong n-grams so
    short queries such as "회의" and "ㅎㅇ" keep working.  The trigram index is
    only used for 3+ character terms, so it can stay compact: original text
    plus full choseong strings for Korean tokens.
    """

    original = WHITESPACE_PATTERN.sub(" ", str(value or "").strip()).lower()
    if not original:
        return ""

    helper_tokens: list[str] = []
    seen: set[str] = set()
    for match in TOKEN_PATTERN.finditer(original):
        choseong = get_choseong(match.group(0))
        if choseong and choseong not in seen:
            seen.add(choseong)
            helper_tokens.append(choseong)

    return " ".join([original, *helper_tokens])


def _query_terms(raw_query: str) -> list[str]:
    cleaned = raw_query.replace('"', " ").replace("*", " ")
    return [term.strip().lower() for term in cleaned.split() if term.strip()]


def _find_direct_span(text: str, terms: list[str]) -> Optional[Tuple[int, int]]:
    lowered = text.lower()
    for term in terms:
        index = lowered.find(term)
        if index >= 0:
            return index, index + len(term)
    return None


def _find_choseong_span(text: str, terms: list[str]) -> Optional[Tuple[int, int]]:
    for term in terms:
        if not term or any(char not in CHOSEONG_SET for char in term):
            continue

        positions: list[int] = []
        choseong_chars: list[str] = []
        for index, char in enumerate(text):
            choseong = _choseong_for_char(char)
            if not choseong:
                continue
            positions.append(index)
            choseong_chars.append(choseong)

        haystack = "".join(choseong_chars)
        start = haystack.find(term)
        if start < 0:
            continue

        end = start + len(term) - 1
        return positions[start], positions[end] + 1

    return None


def make_search_snippet(content: object, raw_query: str, *, context: int = 35) -> str:
    text = str(content or "")
    compact = WHITESPACE_PATTERN.sub(" ", text).strip()
    if not compact:
        return ""

    terms = _query_terms(raw_query)
    span = _find_direct_span(compact, terms) or _find_choseong_span(compact, terms)
    if span is None:
        return compact[:90] + ("..." if len(compact) > 90 else "")

    start, end = span
    clip_start = max(0, start - context)
    clip_end = min(len(compact), end + context)
    prefix = "..." if clip_start > 0 else ""
    suffix = "..." if clip_end < len(compact) else ""
    return (
        f"{prefix}{compact[clip_start:start]}"
        f"**{compact[start:end]}**"
        f"{compact[end:clip_end]}{suffix}"
    )
