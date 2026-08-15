import pandas as pd
import sys
import os

# Add backend directory to sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
from row_reconcile_engine import auto_match_rows_by_keys

def test_ats_customer_lookup():
    print("=== TESTING ATS CUSTOMER ROW-TO-ROW LOOKUP ENGINE ===")

    # Source: ATS-Customers-ENRICHED.xlsx
    # Header is line 0, so Row 1 is data row 0 ('Alpha Corp'), Row 2 is data row 1 ('Beta Pvt Ltd'), Row 3 is data row 2 ('Gamma Inc'), Row 4 is data row 3 ('Delta Services')
    df_src = pd.DataFrame({
        'entity_name_ora': ['Alpha Corp', 'Beta Pvt Ltd', 'Gamma Inc', 'Delta Services'],
        'city_ora': ['Mumbai', 'Delhi', 'Pune', 'Chennai'],
        'state_ora': ['MH', 'DL', 'MH', 'TN'],
    })

    # Target: ATS_Recon.xlsx (Target rows in different order, multi-site for Beta, missing Delta)
    # Target Data Row 1 (idx 0): Beta Pvt Ltd (Mumbai) - Party 1001
    # Target Data Row 2 (idx 1): Alpha Corp (Mumbai) - Party 1002
    # Target Data Row 3 (idx 2): Gamma Inc (Pune) - Party 1003
    # Target Data Row 4 (idx 3): Beta Pvt Ltd (Delhi) - Party 1004
    df_tgt = pd.DataFrame({
        'PARTY_NAME': ['Beta Pvt Ltd', 'Alpha Corp', 'Gamma Inc', 'Beta Pvt Ltd'],
        'CITY': ['Mumbai', 'Mumbai', 'Pune', 'Delhi'],
        'PARTY_NUMBER': ['P-1001', 'P-1002', 'P-1003', 'P-1004'],
    })

    result = auto_match_rows_by_keys(
        df_src,
        df_tgt,
        src_name_col='entity_name_ora',
        tgt_name_col='PARTY_NAME',
        src_city_col='city_ora',
        tgt_city_col='CITY',
        tgt_num_col='PARTY_NUMBER',
    )

    print("\n--- MATCH SUMMARY ---")
    for k, v in result['summary'].items():
        print(f"  {k}: {v}")

    print("\n--- OUTPUT PER SOURCE ROW ---")
    print(f"{'Src Row #':<10} | {'Match Method':<22} | {'Count':<5} | {'Tgt Row #(s)':<15} | {'Target Party Name':<20} | {'Target Party #':<15}")
    print("-" * 105)

    for row in result['report_rows']:
        print(f"{row['Source_Row_Index']:<10} | {row['Match_Method']:<22} | {row['Match_Count']:<5} | {str(row['Target_Row_Index']):<15} | {str(row['Target_PARTY_NAME']):<20} | {str(row['Target_PARTY_NUMBER']):<15}")

    # Assertions
    # Source Row 1 (Alpha Corp, Mumbai) -> Target Row 2 (P-1002) [Name+City / Name Only match]
    row1 = result['report_rows'][0]
    assert '2' in str(row1['Target_Row_Index']), "Alpha Corp should match Target Row 2"

    # Source Row 2 (Beta Pvt Ltd, Delhi) -> Target Row 4 (P-1004, Delhi site) [Name+City tie-breaker!]
    row2 = result['report_rows'][1]
    assert row2['Match_Method'] == 'Name+City', "Beta Pvt Ltd should use Name+City tie-breaker"
    assert str(row2['Target_Row_Index']) == '4', "Beta Pvt Ltd (Delhi) should resolve to Target Row 4"

    # Source Row 4 (Delta Services) -> NO MATCH
    row4 = result['report_rows'][3]
    assert row4['Match_Method'] == 'NO MATCH', "Delta Services should be NO MATCH"

    print("\n[OK] ALL ATS CUSTOMER ROW LOOKUP TESTS PASSED SUCCESSFULLY!")

if __name__ == '__main__':
    test_ats_customer_lookup()
