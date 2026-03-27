## 09:00

### Features Added
- Initialized project structure
- Added `AGENTS.md` with hackathon workflow rules
- Created `CHANGELOG.md` with predefined format

### Files Modified
- AGENTS.md
- CHANGELOG.md
- README.md

### Issues Faced
- None

## 12:47

### Features Added
- Added local template image assets (template_acm.png, template_clique.png)
- Refactored AGENTS.md, README.md, and CHANGELOG.md to use 24-hour time format (HH:MM) instead of "Hour X"

### Files Modified
- AGENTS.md
- CHANGELOG.md
- README.md
- template_acm.png
- template_clique.png

### Issues Faced
- Initial remote image download attempt failed, resolved by using provided local files

## 19:51

### Features Added
- Created initial project folders for frontend and backend
  
### Files Modified
- CHANGELOG.md
- README.md

### Issues Faced
- None

## 22:59

### Features Added
- Implemented weather scoring logic based on route-wise weather conditions
- Implemented route/delay scoring logic using predefined route experience mapping
- Designed functions to calculate maximum risk factor across route segments

### Files Modified
- CHANGELOG.md

### Issues Faced
- Needed to handle default values for missing weather data and route segments

## 23:16

### Features Added
- Trained initial ML model using mock dataset for risk prediction
- Saved trained model as delay_model.pkl
- Integrated prediction logic using predict.py
- Executed test.py to validate model with real-world-like inputs
- Generated risk scores, risk levels, and route suggestions successfully

### Files Modified
- backend/train_model.py
- backend/predict.py
- backend/test.py
- backend/delay_model.pkl
- CHANGELOG.md

### Issues Faced
- Warning related to feature names mismatch in sklearn model during prediction

