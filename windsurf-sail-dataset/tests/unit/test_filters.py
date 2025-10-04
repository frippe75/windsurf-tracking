"""
Unit tests for individual filter functions
"""

import unittest
import sys
import os
import yaml
from pathlib import Path

# Add windsurf package to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from windsurf.filters import filter_sail_count, filter_on_water
from windsurf.detection_utils import ScrubConfig
from windsurf.grounding_dino import detect_sails
from PIL import Image
import numpy as np


class TestSailCountFilter(unittest.TestCase):
    """Test sail counting filter functionality"""
    
    def setUp(self):
        """Set up test configuration"""
        self.scrub_config = ScrubConfig(
            scrub_interval=25,
            max_scrub_attempts=3,  # Reduced for testing
            early_accept_threshold=0.8,
            early_reject_threshold=0.2
        )
        
        # Load test data configuration
        test_data_path = Path(__file__).parent.parent / "test_data.yaml"
        if test_data_path.exists():
            with open(test_data_path) as f:
                self.test_data = yaml.safe_load(f)
        else:
            self.test_data = None
    
    def test_single_sail_detection(self):
        """Test filter with single sail scenario"""
        
        # Skip if no test data available
        if not self.test_data:
            self.skipTest("No test_data.yaml found")
        
        test_case = self.test_data['test_clips']['single_sail_on_water']
        video_path = test_case['source_video']
        
        # Skip if test video doesn't exist
        if not os.path.exists(video_path):
            self.skipTest(f"Test video not found: {video_path}")
        
        # Run filter
        passed, confidence, reason, best_frame = filter_sail_count(
            video_path,
            test_case['start_frame'],
            test_case['end_frame'],
            self.scrub_config
        )
        
        # Validate against expected outcome
        expected = test_case['expected_outcome']['sail_count_filter']
        
        self.assertEqual(passed, expected['passed'])
        self.assertGreaterEqual(confidence, expected.get('confidence_min', 0.0))
        self.assertIn('sail', reason.lower())
        
        if passed:
            self.assertIsNotNone(best_frame, "Should provide best tracking frame for valid clips")
    
    def test_no_sail_rejection(self):
        """Test filter correctly rejects clips with no sails"""
        
        if not self.test_data:
            self.skipTest("No test_data.yaml found")
        
        test_case = self.test_data['test_clips']['beach_interview']
        video_path = test_case['source_video']
        
        if not os.path.exists(video_path):
            self.skipTest(f"Test video not found: {video_path}")
        
        passed, confidence, reason, best_frame = filter_sail_count(
            video_path,
            test_case['start_frame'], 
            test_case['end_frame'],
            self.scrub_config
        )
        
        expected = test_case['expected_outcome']['sail_count_filter']
        
        self.assertEqual(passed, expected['passed'])
        self.assertLessEqual(confidence, expected.get('confidence_max', 1.0))
        self.assertIn('no sail', reason.lower())
    
    def test_multi_sail_rejection(self):
        """Test filter correctly rejects clips with too many sails"""
        
        if not self.test_data:
            self.skipTest("No test_data.yaml found")
        
        test_case = self.test_data['test_clips']['crowded_start_line']
        video_path = test_case['source_video']
        
        if not os.path.exists(video_path):
            self.skipTest(f"Test video not found: {video_path}")
        
        passed, confidence, reason, best_frame = filter_sail_count(
            video_path,
            test_case['start_frame'],
            test_case['end_frame'], 
            self.scrub_config
        )
        
        expected = test_case['expected_outcome']['sail_count_filter']
        
        self.assertEqual(passed, expected['passed'])
        self.assertIn('too many' if not passed else 'sail', reason.lower())


class TestOnWaterFilter(unittest.TestCase):
    """Test water detection filter functionality"""
    
    def setUp(self):
        """Set up test configuration"""
        self.scrub_config = ScrubConfig(scrub_interval=25, max_scrub_attempts=3)
        
        # Load test data
        test_data_path = Path(__file__).parent.parent / "test_data.yaml"
        if test_data_path.exists():
            with open(test_data_path) as f:
                self.test_data = yaml.safe_load(f)
        else:
            self.test_data = None
    
    def test_water_detection(self):
        """Test filter correctly identifies water scenes"""
        
        if not self.test_data:
            self.skipTest("No test_data.yaml found")
        
        test_case = self.test_data['test_clips']['single_sail_on_water']
        video_path = test_case['source_video']
        
        if not os.path.exists(video_path):
            self.skipTest(f"Test video not found: {video_path}")
        
        passed, confidence, reason, water_analysis = filter_on_water(
            video_path,
            test_case['start_frame'],
            test_case['end_frame'],
            self.scrub_config
        )
        
        expected = test_case['expected_outcome']['on_water_filter']
        
        self.assertEqual(passed, expected['passed'])
        self.assertIsNotNone(water_analysis)
        self.assertIn('water_percentage', str(water_analysis))
    
    def test_beach_rejection(self):
        """Test filter correctly rejects beach/land scenes"""
        
        if not self.test_data:
            self.skipTest("No test_data.yaml found")
        
        test_case = self.test_data['test_clips']['beach_interview']
        video_path = test_case['source_video']
        
        if not os.path.exists(video_path):
            self.skipTest(f"Test video not found: {video_path}")
        
        passed, confidence, reason, water_analysis = filter_on_water(
            video_path,
            test_case['start_frame'],
            test_case['end_frame'],
            self.scrub_config
        )
        
        expected = test_case['expected_outcome']['on_water_filter']
        
        self.assertEqual(passed, expected['passed'])
        self.assertIn('not.*water' if not passed else 'water', reason.lower())


class TestMockData(unittest.TestCase):
    """Test with mock frame data when video clips not available"""
    
    def create_mock_frame(self, dominant_color: str, size: tuple = (640, 360)) -> Image.Image:
        """Create a mock frame with dominant color for testing"""
        
        frame = np.zeros((*size[::-1], 3), dtype=np.uint8)
        
        if dominant_color == 'blue':  # Water
            frame[:, :, 2] = 180  # High blue channel
            frame[:, :, 1] = 120  # Medium green
            frame[:, :, 0] = 80   # Low red
        elif dominant_color == 'brown':  # Beach/sand
            frame[:, :, 0] = 160  # High red
            frame[:, :, 1] = 140  # High green  
            frame[:, :, 2] = 100  # Low blue
        elif dominant_color == 'green':  # Land/grass
            frame[:, :, 1] = 180  # High green
            frame[:, :, 0] = 100  # Medium red
            frame[:, :, 2] = 80   # Low blue
        
        return Image.fromarray(frame)
    
    def test_water_analysis_blue_frame(self):
        """Test water analysis on blue (water) frame"""
        from windsurf.filters import analyze_water_content
        
        blue_frame = self.create_mock_frame('blue')
        water_percentage = analyze_water_content(blue_frame)
        
        self.assertGreater(water_percentage, 0.5, "Blue frame should register as water")
    
    def test_water_analysis_beach_frame(self):
        """Test water analysis on brown (beach) frame"""
        from windsurf.filters import analyze_water_content
        
        beach_frame = self.create_mock_frame('brown')
        water_percentage = analyze_water_content(beach_frame)
        
        self.assertLess(water_percentage, 0.3, "Beach frame should not register as water")


if __name__ == '__main__':
    # Create test runner with verbose output
    runner = unittest.TextTestRunner(verbosity=2)
    
    # Create test suite
    suite = unittest.TestSuite()
    
    # Add test classes
    suite.addTest(unittest.makeSuite(TestSailCountFilter))
    suite.addTest(unittest.makeSuite(TestOnWaterFilter))
    suite.addTest(unittest.makeSuite(TestMockData))
    
    # Run tests
    print("Running Windsurf Filter Unit Tests")
    print("=" * 50)
    result = runner.run(suite)
    
    # Print summary
    if result.wasSuccessful():
        print("\\nAll filter tests passed!")
    else:
        print(f"\\nTests failed: {len(result.failures)} failures, {len(result.errors)} errors")