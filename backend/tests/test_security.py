import unittest

from app.security import hash_password, verify_password


class SecurityTests(unittest.TestCase):
    def test_verify_password_accepts_matching_hash(self) -> None:
        encoded_hash = hash_password("secret")

        self.assertTrue(verify_password("secret", encoded_hash))
        self.assertFalse(verify_password("wrong", encoded_hash))

    def test_verify_password_rejects_malformed_hash_without_crashing(self) -> None:
        self.assertFalse(verify_password("secret", "broken-hash"))
        self.assertFalse(verify_password("secret", "still$broken$hash"))


if __name__ == "__main__":
    unittest.main()
