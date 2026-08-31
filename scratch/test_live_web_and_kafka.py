import time
import requests

def run_test():
    print("==================================================")
    print("  Testing Frontend & Backend via Localhost Ports  ")
    print("==================================================")

    # 1. Backend Jobs Status
    res_jobs = requests.get("http://localhost:5000/api/jobs")
    print(f"1. GET http://localhost:5000/api/jobs -> HTTP {res_jobs.status_code}")

    # 2. Upload and Reconcile through Kafka
    source_csv = open("/app/scratch/sample_source_ar.csv", "rb")
    target_csv = open("/app/scratch/sample_target_ar.csv", "rb")

    files = {
        "source_file": ("sample_source_ar.csv", source_csv, "text/csv"),
        "target_file": ("sample_target_ar.csv", target_csv, "text/csv"),
    }
    data = {
        "tolerance": "0.01",
        "async": "true",
    }

    t0 = time.time()
    res_recon = requests.post("http://localhost:5000/api/ar/reconcile", files=files, data=data)
    source_csv.close()
    target_csv.close()

    print(f"2. POST /api/ar/reconcile (Async) -> HTTP {res_recon.status_code}")
    job_payload = res_recon.json()
    job_id = job_payload.get("job_id")
    print(f"   Job Queued to Kafka: {job_id}")

    # 3. Poll status
    for i in range(20):
        time.sleep(0.3)
        res_st = requests.get(f"http://localhost:5000/api/jobs/{job_id}/status")
        st_data = res_st.json()
        status = st_data.get("status")
        pct = st_data.get("progress_pct")
        print(f"   [Poll #{i+1}] Status: {status} ({pct}%)")
        if status == "COMPLETED":
            t1 = time.time()
            elapsed_sec = round(t1 - t0, 3)
            print(f"\n3. SUCCESS! Reconciliation Finished via Kafka Worker in {elapsed_sec}s ({round(elapsed_sec*1000, 1)} ms)")
            summary = st_data.get("result_summary", {}).get("summary", {})
            print("==================================================")
            print("            DASHBOARD RESULTS READY               ")
            print("==================================================")
            print(f"  Source Records      : {summary.get('source_records')}")
            print(f"  Target Records      : {summary.get('target_records')}")
            print(f"  Matched (Balanced)  : {summary.get('matched')}")
            print(f"  Amount Mismatches   : {summary.get('amount_mismatch')}")
            print(f"  Only in Source      : {summary.get('only_in_source')}")
            print(f"  Only in Target      : {summary.get('only_in_target')}")
            print(f"  Net Amount Diff     : ${summary.get('net_diff')}")
            print("==================================================")
            break

if __name__ == "__main__":
    run_test()
