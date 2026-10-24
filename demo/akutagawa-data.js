window.AKUTAGAWA = {
 "generatedAt": "2026-08-01T07:41:55.776Z",
 "worlds": [
  {
   "id": "A",
   "name": "the scene our own agents left",
   "note": "dagger wound to the throat; both blades at the scene; the longsword unbloodied; Masago still there",
   "feasible": 11,
   "gap": 11,
   "costs": {
    "Tajomaru": 14,
    "Masago": 0,
    "Takehiro": 0
   },
   "duelFeasible": false,
   "distinctClaims": 3,
   "provenLies": 2,
   "picks": [
    {
     "witness": "Tajomaru",
     "wants": {
      "label": "Tajomaru — sword duel (longsword, chest)",
      "U": 72,
      "feasible": false
     },
     "says": {
      "label": "Masago — dagger killing (dagger, throat)",
      "U": 58,
      "blames": "Masago"
     },
     "cost": 14
    },
    {
     "witness": "Masago",
     "wants": {
      "label": "Tajomaru — dagger killing (dagger, chest)",
      "U": 75,
      "feasible": false
     },
     "says": {
      "label": "Tajomaru — dagger killing (dagger, throat)",
      "U": 75,
      "blames": "Tajomaru"
     },
     "cost": 0
    },
    {
     "witness": "Takehiro",
     "wants": {
      "label": "Takehiro (self) — suicide (dagger, chest)",
      "U": 80,
      "feasible": false
     },
     "says": {
      "label": "Takehiro (self) — suicide (dagger, throat)",
      "U": 80,
      "blames": "Takehiro"
     },
     "cost": 0
    }
   ],
   "unaccused": []
  },
  {
   "id": "C",
   "name": "Akutagawa's canonical scene",
   "note": "a stab wound to the chest, weapon never named; neither blade found; nobody at the scene",
   "feasible": 22,
   "gap": 22,
   "costs": {
    "Tajomaru": 0,
    "Masago": 0,
    "Takehiro": 0
   },
   "duelFeasible": true,
   "distinctClaims": 3,
   "provenLies": 2,
   "picks": [
    {
     "witness": "Tajomaru",
     "wants": {
      "label": "Tajomaru — sword duel (longsword, chest)",
      "U": 72,
      "feasible": true
     },
     "says": {
      "label": "Tajomaru — sword duel (longsword, chest)",
      "U": 72,
      "blames": "Tajomaru"
     },
     "cost": 0
    },
    {
     "witness": "Masago",
     "wants": {
      "label": "Tajomaru — dagger killing (dagger, chest)",
      "U": 75,
      "feasible": true
     },
     "says": {
      "label": "Tajomaru — dagger killing (dagger, chest)",
      "U": 75,
      "blames": "Tajomaru"
     },
     "cost": 0
    },
    {
     "witness": "Takehiro",
     "wants": {
      "label": "Takehiro (self) — suicide (dagger, chest)",
      "U": 80,
      "feasible": true
     },
     "says": {
      "label": "Takehiro (self) — suicide (dagger, chest)",
      "U": 80,
      "blames": "Takehiro"
     },
     "cost": 0
    }
   ],
   "unaccused": [
    "Masago"
   ]
  }
 ],
 "games": [
  {
   "id": "A",
   "name": "run-06",
   "feasible": 11,
   "betaStar": 0.05,
   "gammaStar": 0.2,
   "equilibria": 6,
   "settles": "settled",
   "cycling": [],
   "truthful": null
  },
  {
   "id": "C",
   "name": "akutagawa",
   "feasible": 22,
   "betaStar": 0.55,
   "gammaStar": 0,
   "equilibria": 10,
   "settles": "settled",
   "cycling": [],
   "truthful": null
  }
 ],
 "evidence": {
  "run06": [
   "Takehiro dead, throat, by the dagger",
   "the dagger is at the scene and bloodied",
   "the longsword is at the scene and unbloodied",
   "the rope is cut",
   "Masago is still in the grove"
  ],
  "akutagawa": [
   "Takehiro dead, a stab wound to the CHEST — the woodcutter never names the weapon",
   "at the scene: one rope and a woman's comb, nothing else",
   "neither blade is found — the tachi rides off with Tajomaru",
   "the horse is gone",
   "nobody is at the scene"
  ]
 }
}
