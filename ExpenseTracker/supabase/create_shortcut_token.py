"""Generate a personal Siri token and enrollment SQL locally; never connect to a database."""
import argparse
import hashlib
import secrets
import uuid


def enrollment(user_id, label):
    person = str(uuid.UUID(user_id))
    label = label.strip()
    if not 1 <= len(label) <= 100:
        raise ValueError("Label must contain 1 to 100 characters.")
    token = "et_" + secrets.token_hex(32)
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    safe_label = label.replace("'", "''")
    sql = (
        "insert into expense_tracker_private.shortcut_tokens (user_id, label, token_hash)\n"
        f"values ('{person}'::uuid, '{safe_label}', '{digest}')\n"
        "returning id, user_id, label, created_at;"
    )
    return token, sql


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user-id", required=True, help="Existing UUID from public.users")
    parser.add_argument("--label", default="iPhone Siri", help="Device label, maximum 100 characters")
    args = parser.parse_args()
    try:
        token, sql = enrollment(args.user_id, args.label)
    except ValueError as error:
        parser.error(str(error))
    print("PERSONAL TOKEN: put this only in your iPhone shortcut; do not commit or share it.")
    print(token)
    print("\nENROLLMENT SQL: run this in the Supabase SQL Editor. It contains only the hash.")
    print(sql)


if __name__ == "__main__":
    main()
