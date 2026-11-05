"""Guard for the daily run's email: what it sends, and that a failure never prints the password."""
import importlib.util
import io
import json
import smtplib
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("send_mail", REPO / "web" / "send_mail.py")
send_mail = importlib.util.module_from_spec(spec)
spec.loader.exec_module(send_mail)


def request(**over):
    return {"user": "me@gmail.com", "password": "secret-app-password", "to": "me@gmail.com", "subject": "חיפוש עבודה", "body": "נוצרו קורות חיים", "attachments": [], **over}


class Output(io.StringIO):
    def reconfigure(self, **_):
        pass


def run(req):
    stdin = mock.Mock(buffer=io.BytesIO(json.dumps(req).encode("utf-8")))
    out = Output()
    with mock.patch.object(send_mail.sys, "stdin", stdin), redirect_stdout(out):
        code = send_mail.main()
    return code, out.getvalue()


class BuildMessage(unittest.TestCase):
    def test_hebrew_and_the_cv_as_a_pdf(self):
        with tempfile.TemporaryDirectory() as folder:
            pdf = Path(folder) / "cv.pdf"
            pdf.write_bytes(b"%PDF-1.5 test")
            message = send_mail.build_message(request(attachments=[{"path": str(pdf), "name": "Dana Cohen - Resume.pdf"}]))
            attachment = next(message.iter_attachments())
            self.assertEqual(attachment.get_filename(), "Dana Cohen - Resume.pdf")
            self.assertEqual(attachment.get_content_type(), "application/pdf")
            self.assertEqual(attachment.get_content(), b"%PDF-1.5 test")
        self.assertEqual(message["Subject"], "חיפוש עבודה")
        self.assertIn("נוצרו קורות חיים", message.get_body().get_content())

    def test_the_password_is_not_in_the_message(self):
        self.assertNotIn("secret-app-password", send_mail.build_message(request()).as_string())


class Send(unittest.TestCase):
    def test_sends_through_gmail_with_the_account(self):
        with mock.patch.object(send_mail.smtplib, "SMTP_SSL") as smtp:
            code, _ = run(request())
        self.assertEqual(code, 0)
        self.assertEqual(smtp.call_args.args, ("smtp.gmail.com", 465))
        session = smtp.return_value.__enter__.return_value
        session.login.assert_called_once_with("me@gmail.com", "secret-app-password")
        session.send_message.assert_called_once()

    def test_a_refused_login_says_so_without_the_password(self):
        with mock.patch.object(send_mail.smtplib, "SMTP_SSL") as smtp:
            smtp.return_value.__enter__.return_value.login.side_effect = smtplib.SMTPAuthenticationError(535, b"secret-app-password rejected")
            code, output = run(request())
        self.assertEqual(code, 1)
        self.assertIn("refused", output)
        self.assertNotIn("secret-app-password", output)

    def test_no_network_is_reported(self):
        with mock.patch.object(send_mail.smtplib, "SMTP_SSL", side_effect=OSError("down")):
            code, output = run(request())
        self.assertEqual(code, 1)
        self.assertIn("could not send", output)


if __name__ == "__main__":
    unittest.main()
