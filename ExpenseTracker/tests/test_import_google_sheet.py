import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile

module_path = Path(__file__).resolve().parents[1] / 'supabase' / 'import_google_sheet.py'
spec = importlib.util.spec_from_file_location('sheet_import', module_path)
sheet_import = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sheet_import)


def workbook(path, amount='12.50', note="Lunch &amp; O'Brien", duplicate=False):
    row = f'''<row r="2"><c r="A2"><v>45719.033280208329</v></c>
      <c r="B2" t="inlineStr"><is><t> PERSON@EXAMPLE.COM </t></is></c>
      <c r="C2" t="inlineStr"><is><t>Food</t></is></c>
      <c r="D2" t="inlineStr"><is><t>{note}</t></is></c>
      <c r="E2"><v>{amount}</v></c></row>'''
    headers = ''.join(f'<c r="{c}1" t="inlineStr"><is><t>{name}</t></is></c>'
                      for c, name in zip('ABCDE', ['Timestamp', 'Email Address', 'Type', 'Description', 'Amount']))
    with zipfile.ZipFile(path, 'w') as archive:
        archive.writestr('xl/workbook.xml', '''<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Form Responses 1" r:id="rId1"/></sheets></workbook>''')
        archive.writestr('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
        archive.writestr('xl/worksheets/sheet1.xml', f'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">{headers}</row>{row}{row if duplicate else ""}</sheetData></worksheet>')


class ImportTests(unittest.TestCase):
    def read(self, **kwargs):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'source.xlsx'
            workbook(path, **kwargs)
            return sheet_import.read_expenses(path)

    def test_email_identity_timestamp_amount_and_description(self):
        item = self.read()[0]
        self.assertEqual(item['email'], 'person@example.com')
        self.assertEqual(item['date'], '2025-03-03')
        self.assertEqual(item['created_at'], '2025-03-03T00:47:55.410000+05:30')
        self.assertEqual(item['amount'], '12.50')
        self.assertEqual(item['note'], "Lunch & O'Brien")

    def test_ids_are_stable_and_distinguish_different_expenses(self):
        self.assertEqual(self.read()[0]['id'], self.read()[0]['id'])
        self.assertNotEqual(self.read()[0]['id'], self.read(amount='13.00')[0]['id'])

    def test_invalid_amounts_fail_before_writing_to_database(self):
        for amount in ['0', '-1', '12.501', 'NaN', '10000000000.00']:
            with self.subTest(amount=amount), self.assertRaises(ValueError):
                self.read(amount=amount)

    def test_exact_duplicates_require_review(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            self.read(duplicate=True)

    def test_sql_escapes_notes_and_verifies_transaction(self):
        sql = sheet_import.build_sql(self.read())
        self.assertIn("Lunch & O''Brien", sql)
        self.assertIn('on conflict (id) do nothing', sql)
        self.assertIn('existing.created_at = source.created_at', sql)
        self.assertIn("raise exception 'Import verification failed", sql)
        self.assertTrue(sql.rstrip().endswith('commit;'))


if __name__ == '__main__':
    unittest.main()
