#!/usr/bin/env python3
"""Sends one email through Gmail. Reads the message as JSON from stdin, so the password is never in the process list."""

import json
import mimetypes
import pathlib
import smtplib
import sys
from email.message import EmailMessage

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 465


def build_message(request: dict) -> EmailMessage:
    message = EmailMessage()
    message["From"] = request["user"]
    message["To"] = request["to"]
    message["Subject"] = request["subject"]
    message.set_content(request["body"])
    for attachment in request.get("attachments", []):
        kind = mimetypes.guess_type(attachment["name"])[0] or "application/octet-stream"
        main, sub = kind.split("/", 1)
        message.add_attachment(pathlib.Path(attachment["path"]).read_bytes(), maintype=main, subtype=sub, filename=attachment["name"])
    return message


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    request = json.load(sys.stdin.buffer)
    try:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=30) as smtp:
            smtp.login(request["user"], request["password"])
            smtp.send_message(build_message(request))
    except smtplib.SMTPAuthenticationError:
        print("Gmail refused the address or the app password")
        return 1
    except (OSError, smtplib.SMTPException) as err:
        print(f"could not send: {type(err).__name__}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
