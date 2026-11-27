"""Auth request/response schemas."""
from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    # Bound argon2 input: min 8 for security, max 128 to avoid hashing DoS.
    password: str = Field(min_length=8, max_length=128)
    display_name: str | None = Field(default=None, max_length=120)
    invite: str | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserOut(BaseModel):
    id: int
    email: str
    display_name: str | None = None
    is_admin: bool = False
    is_approved: bool = False
    avatar_url: str | None = None
    has_password: bool = True
    google_linked: bool = False


class AuthProvidersOut(BaseModel):
    google: bool


class GoogleMobileStartRequest(BaseModel):
    invite: str | None = Field(default=None, max_length=64)


class GoogleMobileStartOut(BaseModel):
    auth_url: str
    handoff_secret: str
    expires_in_sec: int


class GoogleMobileExchangeRequest(BaseModel):
    code: str = Field(min_length=20, max_length=200)
    handoff_secret: str = Field(min_length=20, max_length=200)


class PasswordForgotRequest(BaseModel):
    email: EmailStr


class PasswordResetRequest(BaseModel):
    token: str = Field(min_length=20, max_length=200)
    password: str = Field(min_length=8, max_length=128)
