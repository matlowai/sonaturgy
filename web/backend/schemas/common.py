"""Common response and error schemas."""

from typing import Any, Optional
from pydantic import BaseModel


class ApiResponse(BaseModel):
    success: bool = True
    data: Any = None
    error: Optional[str] = None


class ErrorResponse(BaseModel):
    success: bool = False
    error: str
