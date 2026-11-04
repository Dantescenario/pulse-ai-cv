import base64
import json
import tempfile
import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from unittest.mock import patch, Mock
from pydantic import ValidationError
from services import nutrition_service as n

PHOTO = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\nexample").decode()

class NutritionTests(unittest.TestCase):
    def setUp(self):
        # Invented arithmetic fixtures only, never dietary data for application use.
        folder = tempfile.TemporaryDirectory(prefix='pulseai-synthetic-nutrition-')
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        (self.root/'backend/data').mkdir(parents=True)
        def row(identifier, name, calories, protein, aliases):
            return {'id': identifier, 'name': name, 'aliases': aliases, 'calories': calories,
                    'protein_g': protein, 'carbs_g': 30, 'fat_g': 4, 'fiber_g': 2,
                    'estimated': True, 'source': 'SYNTHETIC UNIT TEST ONLY',
                    'source_url': 'https://example.invalid/synthetic-test'}
        self.custom = [row('synthetic-flatbread', 'Synthetic flatbread', 200, 10, ['testbread', '\u092a\u0930\u0940\u0915\u094d\u0937\u0923']),
                       row('synthetic-legumes', 'Synthetic legumes', 100, 5, [])]
        (self.root/'backend/data/indian_foods.json').write_text(json.dumps(self.custom))
        def usda(identifier, calories):
            return {'fdcId': identifier, 'description': 'SYNTHETIC USDA FORMAT TEST',
                    'foodNutrients': [{'nutrient': {'id': 2048}, 'amount': calories}]}
        (self.root/'FoodData_Central_synthetic.json').write_text(json.dumps({'FoundationFoods': [usda(1,99)]}))
        (self.root/'backend/data/usda_online.json').write_text(json.dumps([usda(1,888),usda(2,100)]))
        context = patch.object(n, 'ROOT', self.root)
        context.start()
        self.addCleanup(context.stop)
        n.catalogue.cache_clear()
        self.addCleanup(n.catalogue.cache_clear)

    def test_synthetic_files_load_and_foundation_takes_precedence(self):
        self.assertEqual(len(n.catalogue()), 4)
        self.assertEqual(n.catalogue()['usda-1']['calories'], 99)
        self.assertEqual(n.catalogue()['usda-2']['calories'], 100)

    def test_missing_and_invalid_catalogue_are_explicit_and_retryable(self):
        custom = self.root/'backend/data/indian_foods.json'
        custom.unlink()  # only the synthetic temporary file
        with self.assertRaises(n.CatalogueUnavailable):
            n.search_foods('testbread')
        custom.write_text('invalid JSON')
        with self.assertRaises(n.CatalogueUnavailable):
            n.search_foods('testbread')
        custom.write_text(json.dumps(self.custom))
        self.assertEqual(n.search_foods('testbread')['matches'], 1)

    def test_private_catalogue_endpoints_return_safe_503(self):
        import main
        from fastapi.testclient import TestClient
        (self.root/'backend/data/indian_foods.json').unlink()
        with patch.object(main.app.state, 'demo_mode', False):
            client = TestClient(main.app)
            for method,path,payload in [('GET','/api/nutrition/foods',None),
                                        ('GET','/api/nutrition/status',None),
                                        ('POST','/api/nutrition/calculate',{'items':[{'food_id':'synthetic-flatbread','grams':60}]})]:
                response = client.request(method,path,json=payload)
                self.assertEqual(response.status_code,503)
                self.assertEqual(response.json()['detail']['code'],'NUTRITION_CATALOGUE_UNAVAILABLE')
                self.assertNotIn(str(self.root),response.text)


    def test_alias_search(self):
        self.assertEqual(n.search_foods("testbread")["foods"][0]["id"], "synthetic-flatbread")
        self.assertEqual(n.search_foods("\u092a\u0930\u0940\u0915\u094d\u0937\u0923")["foods"][0]["id"], "synthetic-flatbread")

    def test_portion_math_and_mixed_meal(self):
        result = n.calculate_meal(n.Calculation(items=[n.Portion(food_id="synthetic-flatbread", grams=60), n.Portion(food_id="synthetic-legumes", grams=180)]))
        self.assertAlmostEqual(result["calories"], 300)
        self.assertAlmostEqual(result["protein_g"], 15)
        self.assertTrue(all(i["estimated"] for i in result["ingredients"]))

    def test_invalid_portions(self):
        for grams in [0, -10, float("nan"), float("inf"), 10001]:
            with self.assertRaises(ValidationError):
                n.Portion(food_id="synthetic-flatbread", grams=grams)
        with self.assertRaises(ValidationError):
            n.Calculation(items=[])

    def test_unknown_food(self):
        with self.assertRaises(ValueError):
            n.calculate_meal(n.Calculation(items=[n.Portion(food_id="missing", grams=100)]))

    def test_atwater_priority_and_null_rows(self):
        food = n.normalize_food({"fdcId": 1, "description": "test", "foodNutrients": [None, {"nutrient": {"id": 2048}, "amount": 99}, {"nutrient": {"id": 1008}, "amount": 100}]})
        self.assertEqual(food["calories"], 99)

    def test_bad_image(self):
        for value in [None, "bad-base64", "data:image/jpeg;base64,YWJj", PHOTO.replace("image/png", "image/jpeg")]:
            with self.assertRaises(ValueError):
                n.analyze_food_image(value)

    @patch('services.food_model.classify')
    def test_local_photo_requires_catalogue_confirmation(self, classify):
        classify.return_value = [{"label": "pizza", "confidence": 0.8}]
        result = n.analyze_food_image(PHOTO)
        self.assertEqual(result["ingredients"], [])
        self.assertEqual(result["predictions"][0]["label"], "pizza")
        self.assertEqual(result["calories"], 0)
        self.assertIn("enter its weight", result["estimate_notice"])

    @patch('services.food_model.classify', side_effect=RuntimeError('Local food model missing'))
    def test_missing_local_model_does_not_fabricate(self, classify):
        with self.assertRaisesRegex(RuntimeError, 'Local food model missing'):
            n.analyze_food_image(PHOTO)

if __name__ == '__main__':
    unittest.main()
