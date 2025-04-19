from pydantic import BaseModel


class Token(BaseModel):
    access_token: str
    token_type: str


class LoginCredentials(BaseModel):
    username: str
    password: str


class RefreshTokenRequest(BaseModel):
    refresh_token: str
