from pathlib import Path
import joblib
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app=FastAPI(title='WaitLess Synthetic ML Demo API')
path=Path(__file__).with_name('wait_model.joblib')
model=joblib.load(path) if path.exists() else None

class Features(BaseModel):
    queue_length: int=Field(ge=0,le=100000)
    active_counters: int=Field(ge=1,le=1000)
    service_duration: float=Field(gt=0,le=240)
    time_of_day: int=Field(ge=0,le=23)
    service_type: int=Field(ge=1)

@app.get('/health')
def health():
    return {'ok':True,'trained_model_loaded':model is not None,'dataset':'synthetic'}

@app.post('/predict')
def predict(features:Features):
    if model is None:
        raise HTTPException(status_code=503,detail='Run python train.py first')
    x=[[features.queue_length,features.active_counters,features.service_duration,features.time_of_day,features.service_type]]
    val=float(model.predict(x)[0])
    return {'predicted_minutes':round(max(0,val),1),'model':'RandomForestRegressor','note':'Synthetic-data demonstration; unvalidated on real queues'}
