"""Synthetic dataset demonstration, NOT validated against actual university queues."""
import random
from pathlib import Path
import joblib
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error
from sklearn.model_selection import train_test_split

random.seed(42)
rows=[]
labels=[]
for _ in range(3500):
    queue=random.randint(0,55)
    counters=random.randint(1,6)
    duration=random.randint(4,20)
    hour=random.randint(8,19)
    service=random.randint(1,8)
    # Assumed queueing relationship, simulated noise and modest peak effects.
    target=max(0,queue*duration/counters + (2 if 11<=hour<=14 else 0) + random.gauss(0,2.5))
    rows.append([queue,counters,duration,hour,service])
    labels.append(target)
X=np.asarray(rows,dtype=float);y=np.asarray(labels,dtype=float)
Xtr,Xte,ytr,yte=train_test_split(X,y,random_state=42,test_size=.2)
model=RandomForestRegressor(n_estimators=110,max_depth=14,min_samples_leaf=2,random_state=42,n_jobs=-1)
model.fit(Xtr,ytr)
mae=mean_absolute_error(yte,model.predict(Xte))
joblib.dump(model,Path(__file__).with_name('wait_model.joblib'))
print(f'Model saved. Synthetic holdout MAE: {mae:.2f} minutes (NOT real-world accuracy).')
