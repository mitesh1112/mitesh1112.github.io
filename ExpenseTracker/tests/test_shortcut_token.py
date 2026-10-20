import hashlib
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "shortcut_token", Path(__file__).parents[1] / "supabase" / "create_shortcut_token.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TokenTests(unittest.TestCase):
    def test_only_hash_goes_into_sql_and_label_is_escaped(self):
        token, sql = module.enrollment("11111111-1111-4111-8111-111111111111", "Mitesh's iPhone")
        self.assertRegex(token, r"^et_[0-9a-f]{64}$")
        self.assertNotIn(token, sql)
        self.assertIn(hashlib.sha256(token.encode()).hexdigest(), sql)
        self.assertIn("Mitesh''s iPhone", sql)
        self.assertNotEqual(token, module.enrollment("11111111-1111-4111-8111-111111111111", "Phone")[0])

    def test_invalid_identity_or_label_is_rejected(self):
        for person, label in [("bad uuid", "Phone"),
                              ("11111111-1111-4111-8111-111111111111", " "),
                              ("11111111-1111-4111-8111-111111111111", "x" * 101)]:
            with self.assertRaises(ValueError):
                module.enrollment(person, label)


if __name__ == "__main__":
    unittest.main()
