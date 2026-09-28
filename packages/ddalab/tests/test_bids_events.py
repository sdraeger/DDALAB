import tempfile
import unittest
from pathlib import Path

from ddalab_app.domain.bids import event_annotations as bids_event_annotations


class BidsEventAnnotationTest(unittest.TestCase):
    def test_reads_events_beside_recording_and_skips_clock_stamps(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            recording = Path(tmp) / "sub-01_task-ictal_run-01_ieeg.vhdr"
            recording.write_text("")
            recording.with_name("sub-01_task-ictal_run-01_events.tsv").write_text(
                "onset\tduration\ttrial_type\n"
                "74.71\t0.0\t+75.000000\n"
                "75.95\t0.0\tonset\n"
                "80.0\t2.5\tsz\n"
                "90.0\t0.0\t1\n"
            )
            other = Path(tmp) / "sub-02" / recording.name
            other.parent.mkdir()
            other.write_text("")
            other.with_name(
                recording.name.replace("ieeg.vhdr", "events.tsv")
            ).write_text("onset\tduration\ttrial_type\n1.0\t0.0\tonset\n")
            events = bids_event_annotations(str(recording))
            other_events = bids_event_annotations(str(other))
        self.assertEqual([event.label for event in events], ["onset", "sz", "1"])
        self.assertNotEqual(events[0].id, other_events[0].id)
        self.assertIsNone(events[0].end_seconds)
        self.assertEqual(events[1].end_seconds, 82.5)
        self.assertEqual(bids_event_annotations(str(Path(tmp) / "none.edf")), [])


if __name__ == "__main__":
    unittest.main()
