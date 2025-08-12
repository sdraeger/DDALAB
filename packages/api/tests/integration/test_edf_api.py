import os
import pytest
from fastapi import status


@pytest.mark.integration
class TestEDFAPI:
    @pytest.mark.asyncio
    async def test_edf_data_differs_across_chunks(
        self, async_client, auth_headers_user
    ):
        # Requires a real EDF file to be available under configured data_dir
        if os.environ.get("ENABLE_EDF_INTEGRATION", "0") != "1":
            pytest.skip("EDF integration disabled")
        test_file = os.environ.get("TEST_EDF_FILE", "edf/MG99_d1_Weds_a.edf")

        r1 = await async_client.get(
            f"/api/edf/data?file_path={test_file}&chunk_start=0&chunk_size=1024",
            headers=auth_headers_user,
        )
        assert r1.status_code == status.HTTP_200_OK
        d1 = r1.json()
        assert "data" in d1 and isinstance(d1["data"], list)
        assert len(d1["data"]) > 0 and len(d1["data"][0]) > 0

        r2 = await async_client.get(
            f"/api/edf/data?file_path={test_file}&chunk_start=1024&chunk_size=1024",
            headers=auth_headers_user,
        )
        assert r2.status_code == status.HTTP_200_OK
        d2 = r2.json()
        assert "data" in d2 and isinstance(d2["data"], list)
        assert len(d2["data"]) > 0 and len(d2["data"][0]) > 0

        sig1 = tuple(round(float(x), 6) for x in d1["data"][0][:8])
        sig2 = tuple(round(float(x), 6) for x in d2["data"][0][:8])
        assert sig1 != sig2, "Expected different chunk data, but signatures matched"

    @pytest.mark.asyncio
    async def test_edf_channel_subset(self, async_client, auth_headers_user):
        if os.environ.get("ENABLE_EDF_INTEGRATION", "0") != "1":
            pytest.skip("EDF integration disabled")
        test_file = os.environ.get("TEST_EDF_FILE", "edf/MG99_d1_Weds_a.edf")
        channels = ["LOF7", "LMF4", "LMF3", "LMF2"]
        qs = ",".join(channels)

        r = await async_client.get(
            f"/api/edf/data?file_path={test_file}&chunk_start=0&chunk_size=1024&channels={qs}",
            headers=auth_headers_user,
        )
        assert r.status_code == status.HTTP_200_OK
        data = r.json()
        assert data["channel_labels"] == channels
        assert len(data["data"]) == len(channels)
