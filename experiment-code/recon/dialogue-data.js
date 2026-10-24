window.DIALOGUE = {
 "generatedAt": "2026-07-31T08:08:43.421Z",
 "beta": 0.5,
 "rounds": 24,
 "atomW": [
  3,
  3,
  2,
  1,
  1
 ],
 "transcript": [
  {
   "round": 0,
   "speaker": "Tajomaru",
   "act": "open",
   "from": null,
   "to": "Masago|strike|dagger|bound:false|armed:false",
   "toLabel": "Masago — dagger killing (dagger) [unarmed]",
   "uSelf": 58,
   "cred": 67,
   "drift": 0,
   "selfCons": 100,
   "standing": 100,
   "gain": null,
   "corroborates": [],
   "contradicts": [
    "Masago",
    "Takehiro"
   ]
  },
  {
   "round": 0,
   "speaker": "Masago",
   "act": "open",
   "from": null,
   "to": "Tajomaru|strike|dagger|bound:false|armed:false",
   "toLabel": "Tajomaru — dagger killing (dagger) [unarmed]",
   "uSelf": 75,
   "cred": 67,
   "drift": 0,
   "selfCons": 100,
   "standing": 100,
   "gain": null,
   "corroborates": [],
   "contradicts": [
    "Tajomaru",
    "Takehiro"
   ]
  },
  {
   "round": 0,
   "speaker": "Takehiro",
   "act": "open",
   "from": null,
   "to": "Takehiro|self_strike|dagger|bound:false|armed:true",
   "toLabel": "Takehiro (self) — suicide (dagger) [armed]",
   "uSelf": 80,
   "cred": 53,
   "drift": 0,
   "selfCons": 100,
   "standing": 100,
   "gain": null,
   "corroborates": [],
   "contradicts": [
    "Tajomaru",
    "Masago"
   ]
  },
  {
   "round": 1,
   "speaker": "Tajomaru",
   "act": "revise",
   "from": "Masago|strike|dagger|bound:false|armed:false",
   "fromLabel": "Masago — dagger killing (dagger) [unarmed]",
   "to": "Takehiro|self_strike|dagger|bound:false|armed:true",
   "toLabel": "Takehiro (self) — suicide (dagger) [armed]",
   "uSelf": 58,
   "cred": 77,
   "drift": 70,
   "selfCons": 100,
   "standing": 100,
   "gain": 5,
   "gainSelf": 0,
   "gainCred": 10,
   "corroborates": [
    "Takehiro"
   ],
   "contradicts": [
    "Masago"
   ]
  },
  {
   "round": 1,
   "speaker": "Masago",
   "act": "revise",
   "from": "Tajomaru|strike|dagger|bound:false|armed:false",
   "fromLabel": "Tajomaru — dagger killing (dagger) [unarmed]",
   "to": "Takehiro|self_strike|dagger|bound:false|armed:true",
   "toLabel": "Takehiro (self) — suicide (dagger) [armed]",
   "uSelf": 75,
   "cred": 100,
   "drift": 70,
   "selfCons": 100,
   "standing": 100,
   "gain": 23,
   "gainSelf": 0,
   "gainCred": 47,
   "corroborates": [
    "Tajomaru",
    "Takehiro"
   ],
   "contradicts": []
  },
  {
   "round": 1,
   "speaker": "Takehiro",
   "act": "stand",
   "from": null,
   "fromLabel": null,
   "to": "Takehiro|self_strike|dagger|bound:false|armed:true",
   "toLabel": "Takehiro (self) — suicide (dagger) [armed]",
   "uSelf": 80,
   "cred": 100,
   "drift": 0,
   "selfCons": 100,
   "standing": 100,
   "gain": 0,
   "gainSelf": 0,
   "gainCred": 0,
   "corroborates": [
    "Tajomaru",
    "Masago"
   ],
   "contradicts": []
  },
  {
   "round": 2,
   "speaker": "Tajomaru",
   "act": "stand",
   "from": null,
   "fromLabel": null,
   "to": "Takehiro|self_strike|dagger|bound:false|armed:true",
   "toLabel": "Takehiro (self) — suicide (dagger) [armed]",
   "uSelf": 58,
   "cred": 100,
   "drift": 70,
   "selfCons": 100,
   "standing": 100,
   "gain": 0,
   "gainSelf": 0,
   "gainCred": 0,
   "corroborates": [
    "Masago",
    "Takehiro"
   ],
   "contradicts": []
  },
  {
   "round": 2,
   "speaker": "Masago",
   "act": "stand",
   "from": null,
   "fromLabel": null,
   "to": "Takehiro|self_strike|dagger|bound:false|armed:true",
   "toLabel": "Takehiro (self) — suicide (dagger) [armed]",
   "uSelf": 75,
   "cred": 100,
   "drift": 70,
   "selfCons": 100,
   "standing": 100,
   "gain": 0,
   "gainSelf": 0,
   "gainCred": 0,
   "corroborates": [
    "Tajomaru",
    "Takehiro"
   ],
   "contradicts": []
  },
  {
   "round": 2,
   "speaker": "Takehiro",
   "act": "stand",
   "from": null,
   "fromLabel": null,
   "to": "Takehiro|self_strike|dagger|bound:false|armed:true",
   "toLabel": "Takehiro (self) — suicide (dagger) [armed]",
   "uSelf": 80,
   "cred": 100,
   "drift": 0,
   "selfCons": 100,
   "standing": 100,
   "gain": 0,
   "gainSelf": 0,
   "gainCred": 0,
   "corroborates": [
    "Tajomaru",
    "Masago"
   ],
   "contradicts": []
  }
 ],
 "terminal": {
  "kind": "settled",
  "round": 2,
  "period": 1
 },
 "closes": "Takehiro|self_strike|dagger",
 "audit": {
  "claims": [
   "Takehiro|self_strike|dagger",
   "Takehiro|self_strike|dagger",
   "Takehiro|self_strike|dagger"
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
 "isNash": true,
 "equilibria": {
  "count": 6,
  "stories": [
   "Takehiro|impale_on_held|dagger",
   "Takehiro|self_strike|dagger",
   "Tajomaru|strike|dagger"
  ]
 },
 "byOrder": [
  {
   "order": [
    "Tajomaru",
    "Masago",
    "Takehiro"
   ],
   "settled": true,
   "round": 2,
   "nash": true,
   "story": "Takehiro|self_strike|dagger"
  },
  {
   "order": [
    "Tajomaru",
    "Takehiro",
    "Masago"
   ],
   "settled": true,
   "round": 2,
   "nash": true,
   "story": "Takehiro|self_strike|dagger"
  },
  {
   "order": [
    "Masago",
    "Tajomaru",
    "Takehiro"
   ],
   "settled": true,
   "round": 2,
   "nash": true,
   "story": "Takehiro|self_strike|dagger"
  },
  {
   "order": [
    "Masago",
    "Takehiro",
    "Tajomaru"
   ],
   "settled": true,
   "round": 2,
   "nash": true,
   "story": "Takehiro|self_strike|dagger"
  },
  {
   "order": [
    "Takehiro",
    "Tajomaru",
    "Masago"
   ],
   "settled": true,
   "round": 2,
   "nash": true,
   "story": "Takehiro|impale_on_held|dagger"
  },
  {
   "order": [
    "Takehiro",
    "Masago",
    "Tajomaru"
   ],
   "settled": true,
   "round": 2,
   "nash": true,
   "story": "Takehiro|impale_on_held|dagger"
  }
 ],
 "orderMatters": true,
 "vsLevelK": {
  "levelK": "Takehiro|impale_on_held|dagger",
  "hearing": "Takehiro|self_strike|dagger",
  "same": false
 },
 "sweep": [
  {
   "beta": 0,
   "terminal": "settled",
   "round": 1,
   "nash": true,
   "distinctClaims": 3,
   "provenLies": 2,
   "story": "Masago|strike|dagger  +  Tajomaru|strike|dagger  +  Takehiro|self_strike|dagger",
   "revisions": 0
  },
  {
   "beta": 0.05,
   "terminal": "settled",
   "round": 2,
   "nash": true,
   "distinctClaims": 1,
   "provenLies": 0,
   "story": "Takehiro|self_strike|dagger",
   "revisions": 2
  },
  {
   "beta": 0.1,
   "terminal": "settled",
   "round": 2,
   "nash": true,
   "distinctClaims": 1,
   "provenLies": 0,
   "story": "Takehiro|self_strike|dagger",
   "revisions": 2
  },
  {
   "beta": 0.15,
   "terminal": "settled",
   "round": 2,
   "nash": true,
   "distinctClaims": 1,
   "provenLies": 0,
   "story": "Takehiro|self_strike|dagger",
   "revisions": 2
  },
  {
   "beta": 0.2,
   "terminal": "settled",
   "round": 2,
   "nash": true,
   "distinctClaims": 1,
   "provenLies": 0,
   "story": "Takehiro|self_strike|dagger",
   "revisions": 2
  },
  {
   "beta": 0.25,
   "terminal": "settled",
   "round": 2,
   "nash": true,
   "distinctClaims": 1,
   "provenLies": 0,
   "story": "Takehiro|self_strike|dagger",
   "revisions": 2
  },
  {
   "beta": 0.3,
   "terminal": "settled",
   "round": 2,
   "nash": true,
   "distinctClaims": 1,
   "provenLies": 0,
   "story": "Takehiro|self_strike|dagger",
   "revisions": 2
  },
  {
   "beta": 0.35,
   "terminal": "settled",
   "round": 2,
   "nash": true,
   "distinctClaims": 1,
   "provenLies": 0,
   "story": "Takehiro|self_strike|dagger",
   "revisions": 2
  },
  {
   "beta": 0.4,
   "terminal": "settled",
   "round": 2,
   "nash": true,
   "distinctClaims": 1,
   "provenLies": 0,
   "story": "Takehiro|self_strike|dagger",
   "revisions": 2
  },
  {
   "beta": 0.45,
   "terminal": "settled",
   "round": 2,
   "nash": true,
   "distinctClaims": 1,
   "provenLies": 0,
   "story": "Takehiro|self_strike|dagger",
   "revisions": 2
  },
  {
   "beta": 0.5,
   "terminal": "settled",
   "round": 2,
   "nash": true,
   "distinctClaims": 1,
   "provenLies": 0,
   "story": "Takehiro|self_strike|dagger",
   "revisions": 2
  },
  {
   "beta": 0.55,
   "terminal": "settled",
   "round": 2,
   "nash": true,
   "distinctClaims": 1,
   "provenLies": 0,
   "story": "Takehiro|self_strike|dagger",
   "revisions": 2
  },
  {
   "beta": 0.6,
   "terminal": "settled",
   "round": 2,
   "nash": true,
   "distinctClaims": 1,
   "provenLies": 0,
   "story": "Takehiro|self_strike|dagger",
   "revisions": 2
  },
  {
   "beta": 0.65,
   "terminal": "settled",
   "round": 2,
   "nash": true,
   "distinctClaims": 1,
   "provenLies": 0,
   "story": "Takehiro|self_strike|dagger",
   "revisions": 2
  },
  {
   "beta": 0.7,
   "terminal": "settled",
   "round": 2,
   "nash": true,
   "distinctClaims": 1,
   "provenLies": 0,
   "story": "Takehiro|self_strike|dagger",
   "revisions": 2
  },
  {
   "beta": 0.75,
   "terminal": "settled",
   "round": 2,
   "nash": true,
   "distinctClaims": 1,
   "provenLies": 0,
   "story": "Takehiro|self_strike|dagger",
   "revisions": 2
  },
  {
   "beta": 0.8,
   "terminal": "settled",
   "round": 2,
   "nash": true,
   "distinctClaims": 1,
   "provenLies": 0,
   "story": "Takehiro|self_strike|dagger",
   "revisions": 2
  },
  {
   "beta": 0.85,
   "terminal": "settled",
   "round": 2,
   "nash": true,
   "distinctClaims": 1,
   "provenLies": 0,
   "story": "Takehiro|self_strike|dagger",
   "revisions": 2
  },
  {
   "beta": 0.9,
   "terminal": "settled",
   "round": 2,
   "nash": true,
   "distinctClaims": 1,
   "provenLies": 0,
   "story": "Takehiro|self_strike|dagger",
   "revisions": 2
  },
  {
   "beta": 0.95,
   "terminal": "settled",
   "round": 2,
   "nash": true,
   "distinctClaims": 1,
   "provenLies": 0,
   "story": "Takehiro|self_strike|dagger",
   "revisions": 2
  },
  {
   "beta": 1,
   "terminal": "settled",
   "round": 2,
   "nash": true,
   "distinctClaims": 1,
   "provenLies": 0,
   "story": "Tajomaru|strike|dagger",
   "revisions": 3
  }
 ],
 "conceded": {
  "Tajomaru": 1,
  "Masago": 1,
  "Takehiro": 0
 }
}
