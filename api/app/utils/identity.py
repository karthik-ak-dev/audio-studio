"""Identity utility functions — no business logic, no DB access."""


def name_from_email(email: str) -> str:
    """Derive a display name from an email address.

    Takes the local part (before @), replaces dots/underscores with spaces,
    and title-cases the result.
    e.g. 'karthik.s@gmail.com' → 'Karthik S'
         'ravi@gmail.com'      → 'Ravi'
         'john_doe@company.io' → 'John Doe'
    """
    local = email.split("@")[0] if "@" in email else email
    return local.replace(".", " ").replace("_", " ").replace("-", " ").title()
