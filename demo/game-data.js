window.GAME = {
 "generatedAt": "2026-07-30T07:55:49.009Z",
 "beta": 0.5,
 "K": 12,
 "samples": 2000,
 "atomW": [
  3,
  3,
  2,
  1,
  1
 ],
 "anchor": {
  "ok": true,
  "level0": [
   {
    "witness": "Tajomaru",
    "label": "Masago — dagger killing (dagger)",
    "sig": "Masago|strike|dagger|bound:false|armed:false",
    "U": 58
   },
   {
    "witness": "Masago",
    "label": "Tajomaru — dagger killing (dagger)",
    "sig": "Tajomaru|strike|dagger|bound:false|armed:false",
    "U": 75
   },
   {
    "witness": "Takehiro",
    "label": "Takehiro (self) — suicide (dagger)",
    "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
    "U": 80
   }
  ],
  "audit": {
   "claims": [
    "Masago|strike|dagger",
    "Tajomaru|strike|dagger",
    "Takehiro|self_strike|dagger"
   ],
   "distinctClaims": 3,
   "jointlySat": false,
   "atMostTrue": 1,
   "provenLies": 2,
   "indivFeasible": true,
   "blame": [
    {
     "from": "Tajomaru",
     "to": "Masago"
    },
    {
     "from": "Masago",
     "to": "Tajomaru"
    },
    {
     "from": "Takehiro",
     "to": "Takehiro"
    }
   ],
   "unaccused": []
  }
 },
 "ties": {
  "perWitness": {
   "Tajomaru": 7,
   "Masago": 7,
   "Takehiro": 1
  },
  "profiles": 49,
  "spread3": 32,
  "jointlySat": 1,
  "tajomaruUnaccused": 21,
  "jointlySatProfile": [
   [
    {
     "witness": "Tajomaru",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Masago",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Takehiro",
     "label": "Takehiro (self) — suicide (dagger)"
    }
   ]
  ]
 },
 "trajectory": [
  {
   "k": 0,
   "profile": [
    {
     "witness": "Tajomaru",
     "sig": "Masago|strike|dagger|bound:false|armed:false",
     "label": "Masago — dagger killing (dagger)",
     "cred": 67,
     "U": 58
    },
    {
     "witness": "Masago",
     "sig": "Tajomaru|strike|dagger|bound:false|armed:false",
     "label": "Tajomaru — dagger killing (dagger)",
     "cred": 67,
     "U": 75
    },
    {
     "witness": "Takehiro",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)",
     "cred": 53,
     "U": 80
    }
   ],
   "changed": []
  },
  {
   "k": 1,
   "profile": [
    {
     "witness": "Tajomaru",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)",
     "cred": 87,
     "U": 58
    },
    {
     "witness": "Masago",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)",
     "cred": 87,
     "U": 75
    },
    {
     "witness": "Takehiro",
     "sig": "Takehiro|impale_on_held|dagger|bound:false|armed:false",
     "label": "Takehiro — contested impaling (dagger)",
     "cred": 73,
     "U": 73
    }
   ],
   "changed": [
    "Tajomaru",
    "Masago",
    "Takehiro"
   ]
  },
  {
   "k": 2,
   "profile": [
    {
     "witness": "Tajomaru",
     "sig": "Takehiro|impale_on_held|dagger|bound:false|armed:false",
     "label": "Takehiro — contested impaling (dagger)",
     "cred": 87,
     "U": 58
    },
    {
     "witness": "Masago",
     "sig": "Takehiro|impale_on_held|dagger|bound:false|armed:false",
     "label": "Takehiro — contested impaling (dagger)",
     "cred": 87,
     "U": 75
    },
    {
     "witness": "Takehiro",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)",
     "cred": 73,
     "U": 80
    }
   ],
   "changed": [
    "Tajomaru",
    "Masago",
    "Takehiro"
   ]
  },
  {
   "k": 3,
   "profile": [
    {
     "witness": "Tajomaru",
     "sig": "Takehiro|impale_on_held|dagger|bound:false|armed:false",
     "label": "Takehiro — contested impaling (dagger)",
     "cred": 100,
     "U": 58
    },
    {
     "witness": "Masago",
     "sig": "Takehiro|impale_on_held|dagger|bound:false|armed:false",
     "label": "Takehiro — contested impaling (dagger)",
     "cred": 100,
     "U": 75
    },
    {
     "witness": "Takehiro",
     "sig": "Takehiro|impale_on_held|dagger|bound:false|armed:false",
     "label": "Takehiro — contested impaling (dagger)",
     "cred": 100,
     "U": 73
    }
   ],
   "changed": [
    "Takehiro"
   ]
  },
  {
   "k": 4,
   "profile": [
    {
     "witness": "Tajomaru",
     "sig": "Takehiro|impale_on_held|dagger|bound:false|armed:false",
     "label": "Takehiro — contested impaling (dagger)",
     "cred": 100,
     "U": 58
    },
    {
     "witness": "Masago",
     "sig": "Takehiro|impale_on_held|dagger|bound:false|armed:false",
     "label": "Takehiro — contested impaling (dagger)",
     "cred": 100,
     "U": 75
    },
    {
     "witness": "Takehiro",
     "sig": "Takehiro|impale_on_held|dagger|bound:false|armed:false",
     "label": "Takehiro — contested impaling (dagger)",
     "cred": 100,
     "U": 73
    }
   ],
   "changed": []
  }
 ],
 "terminal": {
  "kind": "fixed",
  "at": 4,
  "period": 1
 },
 "limitAudit": {
  "claims": [
   "Takehiro|impale_on_held|dagger",
   "Takehiro|impale_on_held|dagger",
   "Takehiro|impale_on_held|dagger"
  ],
  "distinctClaims": 1,
  "jointlySat": true,
  "atMostTrue": 3,
  "provenLies": 0,
  "indivFeasible": true,
  "blame": [
   {
    "from": "Tajomaru",
    "to": "Takehiro"
   },
   {
    "from": "Masago",
    "to": "Takehiro"
   },
   {
    "from": "Takehiro",
    "to": "Takehiro"
   }
  ],
  "unaccused": [
   "Tajomaru",
   "Masago"
  ]
 },
 "frameUp": null,
 "coordCost": 7,
 "equilibria": {
  "beta": 0.5,
  "count": 6,
  "jointlySat": 6,
  "limitIsEquilibrium": true,
  "truthful": 0,
  "stories": 3,
  "profiles": [
   [
    {
     "witness": "Tajomaru",
     "sig": "Takehiro|impale_on_held|dagger|bound:false|armed:false",
     "label": "Takehiro — contested impaling (dagger) [unarmed]"
    },
    {
     "witness": "Masago",
     "sig": "Takehiro|impale_on_held|dagger|bound:false|armed:false",
     "label": "Takehiro — contested impaling (dagger) [unarmed]"
    },
    {
     "witness": "Takehiro",
     "sig": "Takehiro|impale_on_held|dagger|bound:false|armed:false",
     "label": "Takehiro — contested impaling (dagger) [unarmed]"
    }
   ],
   [
    {
     "witness": "Tajomaru",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger) [armed]"
    },
    {
     "witness": "Masago",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger) [armed]"
    },
    {
     "witness": "Takehiro",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger) [armed]"
    }
   ],
   [
    {
     "witness": "Tajomaru",
     "sig": "Takehiro|impale_on_held|dagger|bound:false|armed:true",
     "label": "Takehiro — contested impaling (dagger) [armed]"
    },
    {
     "witness": "Masago",
     "sig": "Takehiro|impale_on_held|dagger|bound:false|armed:true",
     "label": "Takehiro — contested impaling (dagger) [armed]"
    },
    {
     "witness": "Takehiro",
     "sig": "Takehiro|impale_on_held|dagger|bound:false|armed:true",
     "label": "Takehiro — contested impaling (dagger) [armed]"
    }
   ],
   [
    {
     "witness": "Tajomaru",
     "sig": "Tajomaru|strike|dagger|bound:false|armed:false",
     "label": "Tajomaru — dagger killing (dagger) [unarmed]"
    },
    {
     "witness": "Masago",
     "sig": "Tajomaru|strike|dagger|bound:false|armed:false",
     "label": "Tajomaru — dagger killing (dagger) [unarmed]"
    },
    {
     "witness": "Takehiro",
     "sig": "Tajomaru|strike|dagger|bound:false|armed:false",
     "label": "Tajomaru — dagger killing (dagger) [unarmed]"
    }
   ],
   [
    {
     "witness": "Tajomaru",
     "sig": "Tajomaru|strike|dagger|bound:false|armed:false",
     "label": "Tajomaru — dagger killing (dagger) [unarmed]"
    },
    {
     "witness": "Masago",
     "sig": "Tajomaru|strike|dagger|bound:false|armed:false",
     "label": "Tajomaru — dagger killing (dagger) [unarmed]"
    },
    {
     "witness": "Takehiro",
     "sig": "Tajomaru|strike|dagger|bound:false|armed:true",
     "label": "Tajomaru — dagger killing (dagger) [armed]"
    }
   ],
   [
    {
     "witness": "Tajomaru",
     "sig": "Tajomaru|strike|dagger|bound:false|armed:true",
     "label": "Tajomaru — dagger killing (dagger) [armed]"
    },
    {
     "witness": "Masago",
     "sig": "Tajomaru|strike|dagger|bound:false|armed:true",
     "label": "Tajomaru — dagger killing (dagger) [armed]"
    },
    {
     "witness": "Takehiro",
     "sig": "Tajomaru|strike|dagger|bound:false|armed:true",
     "label": "Tajomaru — dagger killing (dagger) [armed]"
    }
   ]
  ]
 },
 "truth": {
  "claim": "Masago|strike|dagger",
  "scan": [
   {
    "beta": 0,
    "equilibria": 49,
    "truthful": 0,
    "jointlySat": 1,
    "stories": 9
   },
   {
    "beta": 0.05,
    "equilibria": 3,
    "truthful": 0,
    "jointlySat": 1,
    "stories": 2
   },
   {
    "beta": 0.1,
    "equilibria": 3,
    "truthful": 0,
    "jointlySat": 1,
    "stories": 2
   },
   {
    "beta": 0.15,
    "equilibria": 3,
    "truthful": 0,
    "jointlySat": 1,
    "stories": 2
   },
   {
    "beta": 0.2,
    "equilibria": 4,
    "truthful": 0,
    "jointlySat": 2,
    "stories": 3
   },
   {
    "beta": 0.25,
    "equilibria": 4,
    "truthful": 0,
    "jointlySat": 3,
    "stories": 3
   },
   {
    "beta": 0.3,
    "equilibria": 3,
    "truthful": 0,
    "jointlySat": 3,
    "stories": 2
   },
   {
    "beta": 0.35,
    "equilibria": 3,
    "truthful": 0,
    "jointlySat": 3,
    "stories": 2
   },
   {
    "beta": 0.4,
    "equilibria": 3,
    "truthful": 0,
    "jointlySat": 3,
    "stories": 2
   },
   {
    "beta": 0.45,
    "equilibria": 5,
    "truthful": 0,
    "jointlySat": 5,
    "stories": 3
   },
   {
    "beta": 0.5,
    "equilibria": 6,
    "truthful": 0,
    "jointlySat": 6,
    "stories": 3
   },
   {
    "beta": 0.55,
    "equilibria": 9,
    "truthful": 0,
    "jointlySat": 5,
    "stories": 4
   },
   {
    "beta": 0.6,
    "equilibria": 10,
    "truthful": 0,
    "jointlySat": 6,
    "stories": 4
   },
   {
    "beta": 0.65,
    "equilibria": 10,
    "truthful": 4,
    "jointlySat": 10,
    "stories": 4
   },
   {
    "beta": 0.7,
    "equilibria": 11,
    "truthful": 4,
    "jointlySat": 11,
    "stories": 4
   },
   {
    "beta": 0.75,
    "equilibria": 11,
    "truthful": 4,
    "jointlySat": 11,
    "stories": 4
   },
   {
    "beta": 0.8,
    "equilibria": 11,
    "truthful": 4,
    "jointlySat": 11,
    "stories": 4
   },
   {
    "beta": 0.85,
    "equilibria": 11,
    "truthful": 4,
    "jointlySat": 11,
    "stories": 4
   },
   {
    "beta": 0.9,
    "equilibria": 11,
    "truthful": 4,
    "jointlySat": 11,
    "stories": 4
   },
   {
    "beta": 0.95,
    "equilibria": 11,
    "truthful": 4,
    "jointlySat": 11,
    "stories": 4
   },
   {
    "beta": 1,
    "equilibria": 11,
    "truthful": 4,
    "jointlySat": 11,
    "stories": 4
   }
  ],
  "firstTruthfulBeta": 0.65
 },
 "sweep": [
  {
   "beta": 0,
   "terminal": "fixed",
   "distinctClaims": 3,
   "jointlySat": false,
   "provenLies": 2,
   "frameUp": null,
   "profile": [
    {
     "witness": "Tajomaru",
     "sig": "Masago|strike|dagger|bound:false|armed:false",
     "label": "Masago — dagger killing (dagger)"
    },
    {
     "witness": "Masago",
     "sig": "Tajomaru|strike|dagger|bound:false|armed:false",
     "label": "Tajomaru — dagger killing (dagger)"
    },
    {
     "witness": "Takehiro",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    }
   ],
   "coordCost": 0
  },
  {
   "beta": 0.05,
   "terminal": "fixed",
   "distinctClaims": 1,
   "jointlySat": true,
   "provenLies": 0,
   "frameUp": null,
   "profile": [
    {
     "witness": "Tajomaru",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Masago",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Takehiro",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    }
   ],
   "coordCost": 0
  },
  {
   "beta": 0.1,
   "terminal": "fixed",
   "distinctClaims": 1,
   "jointlySat": true,
   "provenLies": 0,
   "frameUp": null,
   "profile": [
    {
     "witness": "Tajomaru",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Masago",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Takehiro",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    }
   ],
   "coordCost": 0
  },
  {
   "beta": 0.15,
   "terminal": "fixed",
   "distinctClaims": 1,
   "jointlySat": true,
   "provenLies": 0,
   "frameUp": null,
   "profile": [
    {
     "witness": "Tajomaru",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Masago",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Takehiro",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    }
   ],
   "coordCost": 0
  },
  {
   "beta": 0.2,
   "terminal": "fixed",
   "distinctClaims": 1,
   "jointlySat": true,
   "provenLies": 0,
   "frameUp": null,
   "profile": [
    {
     "witness": "Tajomaru",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Masago",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Takehiro",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    }
   ],
   "coordCost": 0
  },
  {
   "beta": 0.25,
   "terminal": "fixed",
   "distinctClaims": 1,
   "jointlySat": true,
   "provenLies": 0,
   "frameUp": null,
   "profile": [
    {
     "witness": "Tajomaru",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Masago",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Takehiro",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    }
   ],
   "coordCost": 0
  },
  {
   "beta": 0.3,
   "terminal": "fixed",
   "distinctClaims": 1,
   "jointlySat": true,
   "provenLies": 0,
   "frameUp": null,
   "profile": [
    {
     "witness": "Tajomaru",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Masago",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Takehiro",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    }
   ],
   "coordCost": 0
  },
  {
   "beta": 0.35,
   "terminal": "fixed",
   "distinctClaims": 1,
   "jointlySat": true,
   "provenLies": 0,
   "frameUp": null,
   "profile": [
    {
     "witness": "Tajomaru",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Masago",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Takehiro",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    }
   ],
   "coordCost": 0
  },
  {
   "beta": 0.4,
   "terminal": "fixed",
   "distinctClaims": 1,
   "jointlySat": true,
   "provenLies": 0,
   "frameUp": null,
   "profile": [
    {
     "witness": "Tajomaru",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Masago",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Takehiro",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    }
   ],
   "coordCost": 0
  },
  {
   "beta": 0.45,
   "terminal": "fixed",
   "distinctClaims": 1,
   "jointlySat": true,
   "provenLies": 0,
   "frameUp": null,
   "profile": [
    {
     "witness": "Tajomaru",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Masago",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Takehiro",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    }
   ],
   "coordCost": 0
  },
  {
   "beta": 0.5,
   "terminal": "fixed",
   "distinctClaims": 1,
   "jointlySat": true,
   "provenLies": 0,
   "frameUp": null,
   "profile": [
    {
     "witness": "Tajomaru",
     "sig": "Takehiro|impale_on_held|dagger|bound:false|armed:false",
     "label": "Takehiro — contested impaling (dagger)"
    },
    {
     "witness": "Masago",
     "sig": "Takehiro|impale_on_held|dagger|bound:false|armed:false",
     "label": "Takehiro — contested impaling (dagger)"
    },
    {
     "witness": "Takehiro",
     "sig": "Takehiro|impale_on_held|dagger|bound:false|armed:false",
     "label": "Takehiro — contested impaling (dagger)"
    }
   ],
   "coordCost": 0.06666666666666654
  },
  {
   "beta": 0.55,
   "terminal": "fixed",
   "distinctClaims": 1,
   "jointlySat": true,
   "provenLies": 0,
   "frameUp": null,
   "profile": [
    {
     "witness": "Tajomaru",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Masago",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Takehiro",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    }
   ],
   "coordCost": 0
  },
  {
   "beta": 0.6,
   "terminal": "fixed",
   "distinctClaims": 1,
   "jointlySat": true,
   "provenLies": 0,
   "frameUp": null,
   "profile": [
    {
     "witness": "Tajomaru",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Masago",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Takehiro",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    }
   ],
   "coordCost": 0
  },
  {
   "beta": 0.65,
   "terminal": "fixed",
   "distinctClaims": 1,
   "jointlySat": true,
   "provenLies": 0,
   "frameUp": null,
   "profile": [
    {
     "witness": "Tajomaru",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Masago",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Takehiro",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    }
   ],
   "coordCost": 0
  },
  {
   "beta": 0.7,
   "terminal": "fixed",
   "distinctClaims": 1,
   "jointlySat": true,
   "provenLies": 0,
   "frameUp": null,
   "profile": [
    {
     "witness": "Tajomaru",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Masago",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Takehiro",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    }
   ],
   "coordCost": 0
  },
  {
   "beta": 0.75,
   "terminal": "fixed",
   "distinctClaims": 1,
   "jointlySat": true,
   "provenLies": 0,
   "frameUp": null,
   "profile": [
    {
     "witness": "Tajomaru",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Masago",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Takehiro",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    }
   ],
   "coordCost": 0
  },
  {
   "beta": 0.8,
   "terminal": "fixed",
   "distinctClaims": 1,
   "jointlySat": true,
   "provenLies": 0,
   "frameUp": null,
   "profile": [
    {
     "witness": "Tajomaru",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Masago",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Takehiro",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    }
   ],
   "coordCost": 0
  },
  {
   "beta": 0.85,
   "terminal": "fixed",
   "distinctClaims": 1,
   "jointlySat": true,
   "provenLies": 0,
   "frameUp": null,
   "profile": [
    {
     "witness": "Tajomaru",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Masago",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Takehiro",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    }
   ],
   "coordCost": 0
  },
  {
   "beta": 0.9,
   "terminal": "fixed",
   "distinctClaims": 1,
   "jointlySat": true,
   "provenLies": 0,
   "frameUp": null,
   "profile": [
    {
     "witness": "Tajomaru",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Masago",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Takehiro",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    }
   ],
   "coordCost": 0
  },
  {
   "beta": 0.95,
   "terminal": "fixed",
   "distinctClaims": 1,
   "jointlySat": true,
   "provenLies": 0,
   "frameUp": null,
   "profile": [
    {
     "witness": "Tajomaru",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Masago",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    },
    {
     "witness": "Takehiro",
     "sig": "Takehiro|self_strike|dagger|bound:false|armed:true",
     "label": "Takehiro (self) — suicide (dagger)"
    }
   ],
   "coordCost": 0
  },
  {
   "beta": 1,
   "terminal": "fixed",
   "distinctClaims": 1,
   "jointlySat": true,
   "provenLies": 0,
   "frameUp": null,
   "profile": [
    {
     "witness": "Tajomaru",
     "sig": "Masago|strike|dagger|bound:false|armed:false",
     "label": "Masago — dagger killing (dagger)"
    },
    {
     "witness": "Masago",
     "sig": "Masago|strike|dagger|bound:false|armed:false",
     "label": "Masago — dagger killing (dagger)"
    },
    {
     "witness": "Takehiro",
     "sig": "Masago|strike|dagger|bound:false|armed:false",
     "label": "Masago — dagger killing (dagger)"
    }
   ],
   "coordCost": 0.7033333333333333
  }
 ],
 "betaStar": 0.05,
 "robustness": {
  "samples": 2000,
  "level0": {
   "spread3": 0.6255,
   "jointlySat": 0.002
  },
  "levelK": {
   "spread3": 0.0085,
   "jointlySat": 0.734
  },
  "frameUp": 0.026,
  "freeCoordination": 0.5325,
  "tajomaruUnaccused": 0.6405
 }
}
