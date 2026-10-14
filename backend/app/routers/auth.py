"""Authentication endpoints: register, login, me, password change, account deletion."""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..deps import get_current_user
from ..models import User
from ..schemas import (
    AccountDelete,
    AuthResponse,
    LoginRequest,
    PasswordChange,
    UserCreate,
    UserOut,
)
from ..security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["Auth"])


@router.post(
    "/register",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new account",
)
async def register(payload: UserCreate, db: AsyncSession = Depends(get_db)) -> AuthResponse:
    """Create a user, hash the password with bcrypt and return a JWT immediately
    (the frontend can drop the user straight into their dashboard)."""
    email = payload.email.lower().strip()

    existing = await db.scalar(select(User).where(User.email == email))
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists",
        )

    user = User(email=email, hashed_password=hash_password(payload.password))
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return AuthResponse(access_token=create_access_token(user.id), user=UserOut.model_validate(user))


@router.post("/login", response_model=AuthResponse, summary="Log in with email + password")
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)) -> AuthResponse:
    """Verify credentials and return a fresh JWT. Invalid creds → 401."""
    email = payload.email.lower().strip()
    user = await db.scalar(select(User).where(User.email == email))

    if user is None or not verify_password(payload.password, user.hashed_password):
        # Same message for both cases — never reveal whether an email is registered.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password"
        )

    return AuthResponse(access_token=create_access_token(user.id), user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut, summary="Get the authenticated user")
async def me(user: User = Depends(get_current_user)) -> User:
    """Used by the web client to restore a session from a stored token."""
    return user


@router.put(
    "/password",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Change the account password",
)
async def change_password(
    payload: PasswordChange,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Re-verify the current password, then store a fresh bcrypt hash.

    Existing JWTs stay valid (they are stateless) — the client simply keeps
    its session; only future logins need the new password.
    """
    if not verify_password(payload.current_password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Current password is incorrect",
        )
    if payload.current_password == payload.new_password:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="New password must be different from the current one",
        )
    user.hashed_password = hash_password(payload.new_password)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/account/delete",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Permanently delete the account (requires password)",
)
async def delete_account(
    payload: AccountDelete,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Delete the user row; decks → cards → sessions → reviews all cascade
    at the DB level. Issued JWTs become unusable on the next `/auth/me` call
    (the user row no longer exists).
    """
    if not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Password is incorrect",
        )
    await db.delete(user)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
