import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel, EmailStr, Field

from server.config import get_settings

router = APIRouter()


class SignupRequest(BaseModel):
    """Request model for DDA access signup."""

    firstName: str = Field(
        ...,
        min_length=2,
        max_length=50,
        description="First name of the person requesting access",
    )
    lastName: str = Field(
        ...,
        min_length=2,
        max_length=50,
        description="Last name of the person requesting access",
    )
    affiliation: str = Field(
        ...,
        min_length=2,
        max_length=100,
        description="Academic or institutional affiliation",
    )
    email: EmailStr = Field(..., description="Email address for correspondence")

    class Config:
        """Pydantic model configuration."""

        json_schema_extra = {
            "example": {
                "firstName": "John",
                "lastName": "Doe",
                "affiliation": "Salk Institute",
                "email": "jdoe@example.com",
            }
        }


@router.post(
    "/signup",
    response_model=dict,
    summary="Submit DDA access request",
    description="Submit a request for DDA access. An email will be sent to administrators for review.",
)
async def handle_signup(request: SignupRequest):
    try:
        settings = get_settings()

        # Validate email configuration
        if not all(
            [
                settings.admin_email,
                settings.smtp_server,
                settings.smtp_username,
                settings.smtp_password,
            ]
        ):
            logger.error("Missing email configuration")
            raise HTTPException(
                status_code=500,
                detail="Email service not properly configured. Please contact administrator.",
            )

        # Create email message
        msg = MIMEMultipart()
        msg["From"] = settings.smtp_username
        msg["To"] = settings.admin_email
        msg["Subject"] = "New DDA Access Request"

        body = f"""
        New DDA access request received:
        
        First Name: {request.firstName}
        Last Name: {request.lastName}
        Affiliation: {request.affiliation}
        Email: {request.email}
        """

        msg.attach(MIMEText(body, "plain"))

        # Send email
        try:
            with smtplib.SMTP(settings.smtp_server, settings.smtp_port) as server:
                server.starttls()
                server.login(settings.smtp_username, settings.smtp_password)
                server.send_message(msg)
        except smtplib.SMTPException as e:
            logger.error(f"SMTP error: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail="Failed to send email notification. Please try again later.",
            )

        return {"message": "Signup request submitted successfully"}
    except Exception as e:
        logger.error(f"Signup error: {str(e)}")
        if not isinstance(e, HTTPException):
            raise HTTPException(status_code=500, detail="An unexpected error occurred")
