"""ClearPostcode: UK postcode data (lookup, validation, autocomplete, nearest, reverse geocoding, distance, districts,
sectors, areas and places) and Address lookup (Royal Mail PAF, early access), sync and async.
Docs: https://clearpostcode.co.uk/developers/docs"""

from ._async_client import AsyncClearPostcode
from ._base import BULK_POINTS, BULK_POSTCODES, AsyncPage, BulkResult, Page, RateLimit, Result
from ._calls import ReversePoint
from ._client import ClearPostcode
from ._errors import (
    APIConnectionError,
    APIError,
    APITimeoutError,
    AuthenticationError,
    BadRequestError,
    ClearPostcodeError,
    InternalServerError,
    NotFoundError,
    PermissionDeniedError,
    QuotaExceededError,
    RateLimitError,
    UnprocessableEntityError,
)
from ._generated import *  # noqa: F403
from ._generated import __all__ as _types
from ._version import __version__

__all__ = [
    "BULK_POINTS",
    "BULK_POSTCODES",
    "APIConnectionError",
    "APIError",
    "APITimeoutError",
    "AsyncClearPostcode",
    "AsyncPage",
    "AuthenticationError",
    "BadRequestError",
    "BulkResult",
    "ClearPostcode",
    "ClearPostcodeError",
    "InternalServerError",
    "NotFoundError",
    "Page",
    "PermissionDeniedError",
    "QuotaExceededError",
    "RateLimit",
    "RateLimitError",
    "Result",
    "ReversePoint",
    "UnprocessableEntityError",
    "__version__",
    *_types,
]
