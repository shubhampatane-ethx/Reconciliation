import os
import sys
import pandas as pd
import numpy as np

# Add backend directory to sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from schema_engine import generate_schema_mapping_analysis
from row_reconcile_engine import get_row_previews, reconcile_by_row_indexing


def test_header_column_mapping_different_schemas():
  print('=== TEST 1: Header/Column Mapping (Completely Different Schemas) ===')

  df_src1 = pd.DataFrame({
      'client_identifier': ['101', '102', '103', '104'],
      'person_full_name': ['Krishna Tiwari', 'Rahul Sharma', 'Amit Kumar', 'Priya Singh'],
      'telephone': ['+919876543210', '+919876543211', '+919876543212', '+919876543213'],
      'purchase_value': [4500.0, 6000.0, 7500.0, 3200.0],
  })

  df_tgt1 = pd.DataFrame({
      'cust_number': ['101', '102', '103', '104'],
      'customer': ['Krishna Tiwari', 'Rahul Sharma', 'Amit Kumar', 'Priya Singh'],
      'mobile_contact': ['+919876543210', '+919876543211', '+919876543212', '+919876543213'],
      'transaction_amount': [4500.0, 6000.0, 7500.0, 3200.0],
  })

  analysis1 = generate_schema_mapping_analysis(df_src1, df_tgt1)

  print('Source Columns:', analysis1['source_columns'])
  print('Target Columns:', analysis1['target_columns'])
  print('Suggested Source Key:', analysis1['suggested_source_key'])
  print('Suggested Target Key:', analysis1['suggested_target_key'])
  print('Recommended Mappings:')
  for m in analysis1['recommended_mappings']:
    print(f"  {m['source_column']} -> {m['recommended_target']} (Confidence: {m['confidence']*100:.1f}%, Category: {m['category']})")

  assert analysis1['suggested_source_key'] == 'client_identifier'
  assert analysis1['suggested_target_key'] == 'cust_number'
  print("[OK] Test Passed!\n")


def test_header_column_mapping_schema_2():
  print('=== TEST 2: Header/Column Mapping (Dataset 2 - HR System) ===')

  df_src2 = pd.DataFrame({
      'worker_code': ['EMP01', 'EMP02', 'EMP03'],
      'division': ['Engineering', 'Finance', 'HR'],
      'hire_date': ['2022-01-15', '2021-06-20', '2023-03-10'],
      'compensation': [95000, 85000, 70000],
  })

  df_tgt2 = pd.DataFrame({
      'employee_number': ['EMP01', 'EMP02', 'EMP03'],
      'department_name': ['Engineering', 'Finance', 'HR'],
      'joining_date': ['2022-01-15', '2021-06-20', '2023-03-10'],
      'annual_salary': [95000, 85000, 70000],
  })

  analysis2 = generate_schema_mapping_analysis(df_src2, df_tgt2)
  for m in analysis2['recommended_mappings']:
    print(f"  {m['source_column']} -> {m['recommended_target']} (Confidence: {m['confidence']*100:.1f}%, Category: {m['category']})")

  assert analysis2['suggested_source_key'] == 'worker_code'
  assert analysis2['suggested_target_key'] == 'employee_number'
  print("[OK] Test Passed!\n")


def test_row_to_row_indexing():
  print('=== TEST 3: Index-Based Row-to-Row Reconciliation ===')

  # Source DataFrame
  df_src = pd.DataFrame({
      'name': ['Krishna', 'Rahul', 'Amit'],
      'city': ['Pune', 'Delhi', 'Mumbai'],
      'salary': [50000, 60000, 70000],
  })

  # Target DataFrame (different row order!)
  df_tgt = pd.DataFrame({
      'name': ['Amit', 'Krishna', 'Rahul'],
      'city': ['Mumbai', 'Pune', 'Delhi'],
      'salary': [70000, 50000, 65000],  # Rahul has mismatch (65000 vs 60000)
  })

  # User maps custom row indexes:
  # Source 0 (Krishna, Pune, 50000) -> Target 1 (Krishna, Pune, 50000) [MATCH]
  # Source 1 (Rahul, Delhi, 60000) -> Target 2 (Rahul, Delhi, 65000) [MISMATCH]
  # Source 2 (Amit, Mumbai, 70000) -> Target 0 (Amit, Mumbai, 70000) [MATCH]
  row_mappings = [
      {'source_index': 0, 'target_index': 1},
      {'source_index': 1, 'target_index': 2},
      {'source_index': 2, 'target_index': 0},
  ]

  res = reconcile_by_row_indexing(df_src, df_tgt, row_mappings)

  print('Row Reconciliation Summary:', res['summary'])
  print('Matched Rows Count:', len(res['matched_rows']))
  print('Mismatched Rows Count:', len(res['mismatch_rows']))

  assert res['summary']['matched_pairs_count'] == 2
  assert res['summary']['mismatched_pairs_count'] == 1

  # Verify exact pair status
  mismatch = res['mismatch_rows'][0]
  assert mismatch['source_index'] == 1
  assert mismatch['target_index'] == 2
  print('Mismatch details:', mismatch['field_differences'])
  print("[OK] Test 3 Passed!\n")


if __name__ == '__main__':
  test_header_column_mapping_different_schemas()
  test_header_column_mapping_schema_2()
  test_row_to_row_indexing()
  print("ALL TESTS PASSED SUCCESSFULLY!")
