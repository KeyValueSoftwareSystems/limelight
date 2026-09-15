import pickle
import numpy as np
R=pickle.load(open('results2.pkl','rb'))
real=R['real']; meta=R['meta']
print('--- SOLO events (name, margin over 2nd lane) ---')
for e in sorted(real['solo'], key=lambda x:(x['song'],x['t']))[:40]:
    print(f"{e['song']:26} t={e['t']:7.1f} {e['what']:16} score={e['score']:.3f} margin2nd={e['margin']:+.3f} hold={e['hold_s']:.1f}s")
m=np.array([e['margin'] for e in real['solo']])
print('margin over 2nd lane: median %.3f, frac<=0: %.2f, frac>=0.15: %.2f, n=%d'%(np.median(m),(m<=0).mean(),(m>=0.15).mean(),len(m)))
print()
print('--- CALL/RESPONSE pairs ---')
from collections import Counter
c=Counter()
for e in real['call_response']:
    c[tuple(sorted((e['what'],e['other'])))]+=1
for k,v in c.most_common(20): print(f'{v:3}  {k}')
print('total',len(real['call_response']))
print()
print('--- GROUP SWAP ---')
c2=Counter(e['what'] for e in real['group_swap'])
print(c2)
for e in sorted(real['group_swap'], key=lambda x:(x['song'],x['t']))[:20]:
    print(f"{e['song']:26} t={e['t']:7.1f} {e['what']:12} score={e['score']:.3f} hold={e['hold_s']:.1f}")
