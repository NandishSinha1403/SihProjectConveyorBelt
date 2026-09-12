"""Read-only analysis over the incident history.

Nothing in this package writes. Every function takes rows that already exist
in the database and derives a figure from them, so the analytics surface can
never corrupt the record it reports on.
"""
