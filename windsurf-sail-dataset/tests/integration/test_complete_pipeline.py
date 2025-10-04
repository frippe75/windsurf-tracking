"""
Integration tests for complete windsurf pipeline
"""

import unittest
import sys
import os
import yaml
import tempfile
import json
from pathlib import Path

# Add windsurf package to path  
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from windsurf.scene_detection import detect_scenes
from windsurf.clip_validation import validate_multiple_clips, ScrubConfig


class TestPipelineIntegration(unittest.TestCase):
    """Integration tests for complete pipeline workflow"""
    
    def setUp(self):
        """Set up test environment"""
        self.test_data_path = Path(__file__).parent.parent / "test_data.yaml"
        
        if self.test_data_path.exists():
            with open(self.test_data_path) as f:
                self.test_data = yaml.safe_load(f)
        else:
            self.test_data = None
            
        self.scrub_config = ScrubConfig(
            scrub_interval=25,
            max_scrub_attempts=3,  # Quick tests
            early_accept_threshold=0.8,
            early_reject_threshold=0.2
        )
    
    def test_scene_detection_to_validation_flow(self):
        """Test data flow from scene detection to clip validation"""
        
        # Use the existing working video for integration testing
        test_video = "../cache/IszuR8u0Ybc_full.mp4"
        
        if not os.path.exists(test_video):
            self.skipTest(f"Test video not found: {test_video}")
        
        print(f"\\nTesting pipeline flow with {test_video}")
        
        # Step 1: Scene detection
        print("Running scene detection...")
        segments_data = detect_scenes(test_video)
        
        self.assertIsInstance(segments_data, dict)
        self.assertIn('total_segments', segments_data)
        self.assertIn('segments', segments_data)
        self.assertGreater(segments_data['total_segments'], 0)
        
        print(f"Scene detection: {segments_data['total_segments']} segments generated")
        
        # Step 2: Clip validation (test first few clips only for speed)
        print("Running clip validation...")
        test_segments = {
            'source_video': segments_data['source_video'],
            'total_segments': min(5, segments_data['total_segments']),  # Test first 5 clips
            'segments': segments_data['segments'][:5]
        }
        
        validation_results = validate_multiple_clips(test_segments, self.scrub_config)
        
        self.assertIsInstance(validation_results, dict)
        self.assertIn('accepted_clips', validation_results)
        self.assertIn('rejected_clips', validation_results)
        self.assertIn('acceptance_rate', validation_results)
        
        print(f"Validation: {len(validation_results['accepted_clips'])} accepted, {len(validation_results['rejected_clips'])} rejected")
        
        # Verify data structure compatibility
        for accepted_clip in validation_results['accepted_clips']:
            self.assertIn('segment', accepted_clip)
            self.assertIn('overall_confidence', accepted_clip)
            self.assertIn('filter_results', accepted_clip)
        
        print("✓ Scene detection → Validation data flow working correctly")
    
    def test_validation_performance(self):
        """Test that validation meets performance targets"""
        
        if not self.test_data:
            self.skipTest("No test_data.yaml found")
        
        performance_targets = self.test_data['test_config']['performance_targets']
        
        # This would test actual performance with real clips
        # For now, just verify configuration is reasonable
        self.assertLessEqual(self.scrub_config.scrub_interval, 30, "Scrub interval should be reasonable")
        self.assertLessEqual(self.scrub_config.max_scrub_attempts, 10, "Max attempts should be reasonable")
        
        print("✓ Performance configuration within reasonable bounds")
    
    def test_filter_error_handling(self):
        """Test filter behavior with invalid inputs"""
        
        # Test with non-existent video
        passed, confidence, reason, data = filter_sail_count(
            "nonexistent_video.mp4", 0, 100, self.scrub_config
        )
        
        self.assertFalse(passed, "Should fail with non-existent video")
        self.assertEqual(confidence, 0.0, "Should have zero confidence on error")
        self.assertIn('error', reason.lower(), "Should indicate error in reason")
        
        print("✓ Error handling working correctly")
    
    def test_data_structure_consistency(self):
        """Test that all pipeline components return consistent data structures"""
        
        # Test scene detection output format
        mock_video_info = {
            'path': 'test.mp4',
            'name': 'test',
            'duration': 60.0,
            'fps': 25.0,
            'frame_count': 1500
        }
        
        # This tests the data structure without actual video processing
        from windsurf.scene_detection import VideoInfo, generate_overlapping_segments
        
        video_info = VideoInfo(**mock_video_info)
        segments = generate_overlapping_segments(video_info)
        
        self.assertIsInstance(segments, list)
        if segments:
            segment = segments[0]
            required_fields = ['clip_id', 'start_frame', 'end_frame', 'start_time', 'end_time', 'duration']
            for field in required_fields:
                self.assertIn(field, segment.__dict__)
        
        print("✓ Data structure consistency verified")


class TestPipelineConfiguration(unittest.TestCase):
    """Test pipeline configuration and setup"""
    
    def test_scrub_config_validation(self):
        """Test scrub configuration parameters"""
        
        # Test valid configuration
        config = ScrubConfig(scrub_interval=25, max_scrub_attempts=5)
        self.assertGreater(config.scrub_interval, 0)
        self.assertGreater(config.max_scrub_attempts, 0)
        self.assertLessEqual(config.early_accept_threshold, 1.0)
        self.assertGreaterEqual(config.early_reject_threshold, 0.0)
        
        print("✓ Scrub configuration validation working")
    
    def test_filter_chain_setup(self):
        """Test that filter chain can be configured properly"""
        
        from windsurf.clip_validation import ClipValidator
        
        validator = ClipValidator(ScrubConfig())
        
        # Check default filters are loaded
        self.assertGreater(len(validator.filters), 0)
        
        # Test adding custom filter
        def custom_filter(video_path, start_frame, end_frame, config):
            return True, 1.0, "Custom filter", None
        
        initial_count = len(validator.filters)
        validator.add_filter(custom_filter)
        self.assertEqual(len(validator.filters), initial_count + 1)
        
        print("✓ Filter chain configuration working")


if __name__ == '__main__':
    # Run tests with detailed output
    print("Windsurf Pipeline Unit Tests")
    print("=" * 50)
    
    # Discover and run all tests
    loader = unittest.TestLoader()
    suite = loader.loadTestsFromModule(sys.modules[__name__])
    
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    
    # Print final summary
    print("\\n" + "=" * 50)
    if result.wasSuccessful():
        print("✓ All integration tests passed!")
    else:
        print(f"✗ Tests failed: {len(result.failures)} failures, {len(result.errors)} errors")
        
    print(f"Tests run: {result.testsRun}")
    print(f"Time: {result.time if hasattr(result, 'time') else 'N/A'}")