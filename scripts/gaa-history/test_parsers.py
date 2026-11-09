"""Regression checks for monetary double counting, units, and agency attribution."""
import tempfile
from pathlib import Path
import unittest

import parse_objects
import parse_programs
from parse_summary import reconcile


PREFIX = """I. CONGRESS OF THE PHILIPPINES
A. SENATE
For general administration, as indicated hereunder....... P 150,000
New Appropriations, by Program/Project
 a. General administration       100,000     50,000     150,000
TOTAL NEW APPROPRIATIONS         100,000     50,000     150,000
"""

OBJECTS = """New Appropriations, by Object of Expenditures
(In Thousand Pesos)
Personnel Services
 Basic Salary                               80
 Total Basic Pay                            80
 Other Compensation                         20
 Gross Compensation                        100
 Total Personnel Services                  100
Maintenance and Other Operating Expenses
 Supplies                                   50
 Total Maintenance and Other Operating Expenses       50
TOTAL NEW APPROPRIATIONS                    150
"""


class MonetaryRegressionTests(unittest.TestCase):
    def parse(self, text, parser):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "document.txt").write_text(text)
            return parser(root, dict(text_path="document.txt", year=2005,
                document_id="test", url="https://www.dbm.gov.ph/test.pdf",
                member=None, document_sha256="test-sha"))

    def test_subtotals_never_become_spending(self):
        sections = self.parse(PREFIX + OBJECTS, parse_objects.parse_document)
        self.assertEqual(sections[0]["reasons"], [])
        self.assertEqual(len(sections[0]["rows"]), 3)
        self.assertEqual(sum(r["amount"] for r in sections[0]["rows"]), 150000)

    def test_missing_scale_is_not_assumed(self):
        sections = self.parse(PREFIX + OBJECTS.replace("(In Thousand Pesos)", ""),
                              parse_objects.parse_document)
        self.assertIn("unit_not_confirmed", sections[0]["reasons"])

    def test_mismatch_is_rejected_not_balanced(self):
        sections = self.parse(PREFIX + OBJECTS.replace("Supplies                                   50", "Supplies                                   51"),
                              parse_objects.parse_document)
        self.assertIn("object_sum_mismatch", sections[0]["reasons"])
        self.assertEqual(sections[0]["total_extracted"], 151000)

    def test_page_header_is_not_a_monetary_row(self):
        text = PREFIX + OBJECTS.replace(" Basic Salary", "\fCONGRESS OF THE PHILIPPINES 3\n Basic Salary")
        sections = self.parse(text, parse_objects.parse_document)
        self.assertEqual(sections[0]["reasons"], [])
        self.assertEqual(sections[0]["rows"][0]["source_page"], 2)

    def test_negative_amount_keeps_its_sign(self):
        text = (PREFIX + OBJECTS).replace("Compensation                         20", "Compensation                         (20)")
        text = text.replace("Compensation                        100", "Compensation                         60")
        text = text.replace("Services                  100", "Services                   60")
        text = text.replace("APPROPRIATIONS                    150", "APPROPRIATIONS                    110")
        section = self.parse(text, parse_objects.parse_document)[0]
        self.assertEqual(section["reasons"], [])
        self.assertEqual(section["rows"][1]["amount"], -20000)

    def test_program_identity_uses_current_agency(self):
        text = PREFIX + """A.1 SENATE ELECTORAL TRIBUNAL
For adjudication, as indicated hereunder...... P 30,000
New Appropriations, by Program/Project
 a. Adjudication               20,000       10,000       30,000
TOTAL NEW APPROPRIATIONS        20,000       10,000       30,000
"""
        sections = self.parse(text, parse_programs.parse_document)
        self.assertEqual([s["agency"] for s in sections], ["SENATE", "SENATE ELECTORAL TRIBUNAL"])
        self.assertTrue(all(not s["reasons"] for s in sections))
        self.assertEqual([s["total_extracted"] for s in sections], [150000, 30000])

    def test_purpose_table_is_a_separate_grain(self):
        section=self.parse(PREFIX.replace('by Program/Project','by Purpose'),parse_programs.parse_document)[0]
        self.assertEqual(section['reasons'],[])
        self.assertEqual(section['table_kind'],'purpose')
        self.assertEqual(section['rows'][0]['grain'],'purpose_total')

    def test_summary_mixed_case_acronym_and_parent_children(self):
        records = [dict(code='I.', name='DEPARTMENT OF TRANSPORTATION (DOTr)', amount='100'),
                   dict(code='A.', name='Group', amount='100'),
                   dict(code='A.1.', name='First agency', amount='40'),
                   dict(code='A.2.', name='Second agency', amount='60'),
                   dict(code='', name='TOTAL NEW APPROPRIATIONS', amount='100')]
        groups, reported, total, annexes, issues = reconcile(records)
        self.assertEqual(issues, [])
        self.assertEqual(reported, total)
        self.assertEqual([r['code'] for r in groups[0]['selected_agencies']], ['A.1','A.2'])

    def test_summary_missing_agency_uses_parent_without_balancing(self):
        groups, _, _, _, issues = reconcile([
            dict(code='I',name='DEPARTMENT',amount='100'),
            dict(code='A',name='Agency',amount='90'),
            dict(code='',name='TOTAL NEW APPROPRIATIONS',amount='100')])
        self.assertEqual(issues, [])
        self.assertFalse(groups[0]['agency_partition_reconciled'])

    def test_summary_national_mismatch_is_explicit(self):
        *_, issues = reconcile([dict(code='I',name='DEPARTMENT',amount='100'),
                                dict(code='',name='TOTAL NEW APPROPRIATIONS',amount='101')])
        self.assertIn('national_control_mismatch', issues)

    def test_agency_double_letter_does_not_replace_department(self):
        lines = ['XXVI. OTHER EXECUTIVE OFFICES', 'AA. PHILIPPINE DRUG ENFORCEMENT AGENCY',
                 'For drug enforcement, as indicated hereunder... P 1,000',
                 'New Appropriations, by Program/Project']
        self.assertEqual(parse_objects.identity(lines,3,with_code=True),
            ('OTHER EXECUTIVE OFFICES','PHILIPPINE DRUG ENFORCEMENT AGENCY','AA'))


if __name__ == "__main__":
    unittest.main()
