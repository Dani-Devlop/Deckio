"""Authentication endpoints: register, login, me."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..deps import get_current_user
from ..models import User
from ..schemas import AuthResponse, LoginRequest, UserCreate, UserOut
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
