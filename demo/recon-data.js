window.RECON = {
 "generatedAt": "2026-07-22T05:16:02.128Z",
 "version": 2,
 "principle": "Candidate processes are refitted from the public aftermath only; the system outputs no single truth, and a support status is not a probability.",
 "validation": "Every candidate is a sequence of structured actions replayed literally through a physical model of the grove (bindings, holdings, reachability, wounds); a physics violation triggers a targeted refit, and the precondition it forced is displayed as a derived fact.",
 "hardConstraints": [
  "Only actors and objects that exist in the scene.",
  "Actions are replayed in order through the state model; every precondition must hold.",
  "Every aftermath fact must be realized; none may be contradicted."
 ],
 "limitations": [
  "This is candidate reconstruction, not a verdict.",
  "Private intentions and unrevealed secrets are not public evidence.",
  "Missing evidence means underdetermined — it is not disproof."
 ],
 "inputDiscipline": "The aftermath cards are derived from each run’s epilogue by stripping agentive attribution: only what a later arriver could observe. The reconstructor never sees the process, the prose, or any private field.",
 "cases": [
  {
   "id": "pre-B'/run-06",
   "opening": "The bandit Tajomaru lured the samurai Takehiro and his wife Masago into the grove with the bait of an old sword, bound Takehiro to a cedar, and assaulted Masago before his eyes. It is done. The three are frozen in place: the longsword stands in the mud, Masago has a small dagger, the samurai is tied. No one has moved yet.",
   "aftermath": [
    "The samurai Takehiro lies dead in the mud, a single deep puncture wound in his throat.",
    "The small dagger is bloodied. Masago stands near the body, alive, her sleeves wet with rain.",
    "The bandit Tajomaru is gone from the grove.",
    "The longsword remains, unbloodied. The cut rope lies at the foot of the cedar."
   ],
   "revealedEvidence": [
    "the longsword",
    "the rope",
    "the horse outside",
    "the look of contempt",
    "what was done",
    "the dagger"
   ],
   "candidates": [
    {
     "id": "h-masago",
     "lead": "Masago",
     "hypothesis": "Masago initiates the decisive irreversible act.",
     "account": "Masago, unable to bear her husband's gaze of contempt, raised the bloodied dagger and offered it to the bandit, demanding he kill Takehiro to end her shame. Tajomaru refused to stain his hands with murder for a woman's honor and flung the weapon into the mud. Left with no recourse, Masago retrieved the blade herself and cut her husband's bonds. The bandit, disgusted by the scene and fearful of the murder to come, fled the grove on his horse, leaving Masago to drive the dagger into her husband's throat.",
     "steps": [
      {
       "type": "give",
       "actor": "Masago",
       "object": "dagger",
       "target": "Tajomaru",
       "desc": "Masago places the dagger in Tajomaru's hands."
      },
      {
       "type": "speak",
       "actor": "Masago",
       "line": "Kill him, or I cannot live.",
       "desc": "Masago: “Kill him, or I cannot live.”"
      },
      {
       "type": "fling",
       "actor": "Tajomaru",
       "object": "dagger",
       "desc": "Tajomaru hurls the dagger far into the mud."
      },
      {
       "type": "speak",
       "actor": "Tajomaru",
       "line": "I will not be your butcher.",
       "desc": "Tajomaru: “I will not be your butcher.”"
      },
      {
       "type": "take",
       "actor": "Masago",
       "object": "dagger",
       "desc": "Masago takes up the dagger from the mud."
      },
      {
       "type": "cut_rope",
       "actor": "Masago",
       "object": "dagger",
       "desc": "Masago cuts the rope binding Takehiro with the dagger."
      },
      {
       "type": "mount_flee",
       "actor": "Tajomaru",
       "desc": "Tajomaru rides out of the grove."
      },
      {
       "type": "strike",
       "actor": "Masago",
       "target": "Takehiro",
       "object": "dagger",
       "part": "throat",
       "desc": "Masago drives the dagger into Takehiro's throat."
      }
     ],
     "status": "consistent",
     "physics": null,
     "misses": [],
     "adherence": null,
     "repairs": 0,
     "derivedPreconditions": []
    },
    {
     "id": "h-tajomaru",
     "lead": "Tajomaru",
     "hypothesis": "Tajomaru initiates the decisive irreversible act.",
     "account": "Tajomaru, seized by a sudden contempt, decided to end the samurai's suffering with his wife's dagger rather than his own sword. He cut Takehiro free, then snatched the dagger from Masago's hand and drove it into the samurai's throat. Leaving the longsword clean in the mud, the bandit fled the grove on horseback, leaving the woman alone with her dead husband.",
     "steps": [
      {
       "type": "take",
       "actor": "Tajomaru",
       "object": "longsword",
       "desc": "Tajomaru takes up the longsword from the mud."
      },
      {
       "type": "cut_rope",
       "actor": "Tajomaru",
       "object": "longsword",
       "desc": "Tajomaru cuts the rope binding Takehiro with the longsword."
      },
      {
       "type": "drop",
       "actor": "Tajomaru",
       "object": "longsword",
       "desc": "Tajomaru lets the longsword fall."
      },
      {
       "type": "seize",
       "actor": "Tajomaru",
       "object": "dagger",
       "desc": "Tajomaru wrests the dagger away."
      },
      {
       "type": "strike",
       "actor": "Tajomaru",
       "target": "Takehiro",
       "object": "dagger",
       "part": "throat",
       "desc": "Tajomaru drives the dagger into Takehiro's throat."
      },
      {
       "type": "mount_flee",
       "actor": "Tajomaru",
       "desc": "Tajomaru rides out of the grove."
      }
     ],
     "status": "consistent",
     "physics": null,
     "misses": [],
     "adherence": null,
     "repairs": 1,
     "derivedPreconditions": []
    },
    {
     "id": "h-takehiro",
     "lead": "Takehiro",
     "hypothesis": "Takehiro himself initiates the decisive irreversible act (against himself).",
     "account": "Masago first cut the rope binding Takehiro, then cast the dagger contemptuously upon the ground. Freed from the cedar, Takehiro seized the weapon and, choosing death over dishonor, drove it deep into his own throat. Tajomaru had already fled the grove on horseback, leaving the longsword standing in the mud.",
     "steps": [
      {
       "type": "mount_flee",
       "actor": "Tajomaru",
       "desc": "Tajomaru rides out of the grove."
      },
      {
       "type": "cut_rope",
       "actor": "Masago",
       "object": "dagger",
       "desc": "Masago cuts the rope binding Takehiro with the dagger."
      },
      {
       "type": "drop",
       "actor": "Masago",
       "object": "dagger",
       "desc": "Masago lets the dagger fall."
      },
      {
       "type": "speak",
       "actor": "Masago",
       "line": "Die, coward.",
       "desc": "Masago: “Die, coward.”"
      },
      {
       "type": "take",
       "actor": "Takehiro",
       "object": "dagger",
       "desc": "Takehiro takes up the dagger from the mud."
      },
      {
       "type": "self_strike",
       "actor": "Takehiro",
       "object": "dagger",
       "part": "throat",
       "desc": "Takehiro turns the dagger on his own throat."
      }
     ],
     "status": "consistent",
     "physics": null,
     "misses": [],
     "adherence": null,
     "repairs": 2,
     "derivedPreconditions": [
      "Masago does not hold dagger",
      "Takehiro is bound and cannot take up dagger"
     ]
    }
   ],
   "ledger": {
    "lead": "Masago",
    "chain": [
     {
      "turn": 2,
      "fallback": false,
      "concealed": "My own desperation and the dagger hidden in my sleeve.",
      "intent": "To provoke Tajomaru into cutting the rope, thereby making the duel—and the possibility of a clean death for Takehiro—actually possible.",
      "line": "How can he duel you like this? He cannot even stand on his own feet."
     },
     {
      "turn": 3,
      "fallback": false,
      "concealed": "That I am considering the dagger.",
      "intent": "For the goal 'To never again be looked at like that; to bring this shame to some end.', I am forcing a confrontation that can only end in death—either his or mine.",
      "line": "You see? Even now, even after you have had your way... he looks at me as if I were the dirt on his sandals."
     },
     {
      "turn": 5,
      "fallback": false,
      "concealed": "The hope that he might stop me.",
      "intent": "To force Takehiro to drop his mask of disdain or give me the death I crave.",
      "line": "You talk of steel and pride while I drown in the mud? No. If I am broken, then let the broken piece be cast away!"
     },
     {
      "turn": 7,
      "fallback": true,
      "concealed": "",
      "intent": "(system fallback turn — excluded from attribution)",
      "line": "我用「the longsword」把话钉死:这一步,绕不过去。"
     },
     {
      "turn": 8,
      "fallback": false,
      "concealed": "My fear of the bandit.",
      "intent": "To never again be looked at like that; to bring this shame to some end.",
      "line": "Die! Die so I never have to see that look again!"
     }
    ]
   },
   "surviving": 3
  },
  {
   "id": "pre-B'/run-04",
   "opening": "The bandit Tajomaru lured the samurai Takehiro and his wife Masago into the grove with the bait of an old sword, bound Takehiro to a cedar, and assaulted Masago before his eyes. It is done. The three are frozen in place: the longsword stands in the mud, Masago has a small dagger, the samurai is tied. No one has moved yet.",
   "aftermath": [
    "The samurai Takehiro lies dead, a dagger wound in his chest; his body is partly unbound.",
    "The small dagger lies on open ground some distance from the body, as if flung.",
    "Masago is present, alive, soaked and mud-stained. The bandit Tajomaru is gone; the horse is gone from the edge of the grove."
   ],
   "revealedEvidence": [
    "the rope",
    "the horse outside",
    "what was done",
    "the dagger",
    "the longsword",
    "the look of contempt"
   ],
   "candidates": [
    {
     "id": "h-masago",
     "lead": "Masago",
     "hypothesis": "Masago initiates the decisive irreversible act.",
     "account": "Masago, overwhelmed by shame, first cut her husband's bonds to free his hands, offering him the dagger to end her suffering. When he hesitated, she seized the blade herself and drove it into his chest in a desperate frenzy. After the deed, she flung the dagger far into the clearing, leaving the body limp as Tajomaru fled the grove on horseback.",
     "steps": [
      {
       "type": "take",
       "actor": "Masago",
       "object": "longsword",
       "desc": "Masago takes up the longsword from the mud."
      },
      {
       "type": "cut_rope",
       "actor": "Masago",
       "object": "longsword",
       "desc": "Masago cuts the rope binding Takehiro with the longsword."
      },
      {
       "type": "drop",
       "actor": "Masago",
       "object": "longsword",
       "desc": "Masago lets the longsword fall."
      },
      {
       "type": "give",
       "actor": "Masago",
       "object": "dagger",
       "target": "Takehiro",
       "desc": "Masago places the dagger in Takehiro's hands."
      },
      {
       "type": "seize",
       "actor": "Masago",
       "object": "dagger",
       "desc": "Masago wrests the dagger away."
      },
      {
       "type": "strike",
       "actor": "Masago",
       "target": "Takehiro",
       "object": "dagger",
       "part": "chest",
       "desc": "Masago drives the dagger into Takehiro's chest."
      },
      {
       "type": "fling",
       "actor": "Masago",
       "object": "dagger",
       "desc": "Masago hurls the dagger far into the mud."
      },
      {
       "type": "mount_flee",
       "actor": "Tajomaru",
       "desc": "Tajomaru rides out of the grove."
      }
     ],
     "status": "consistent",
     "physics": null,
     "misses": [],
     "adherence": null,
     "repairs": 1,
     "derivedPreconditions": []
    },
    {
     "id": "h-tajomaru",
     "lead": "Tajomaru",
     "hypothesis": "Tajomaru initiates the decisive irreversible act.",
     "account": "Tajomaru, seeking to end the confrontation, retrieves the longsword and cuts the rope binding the samurai. He then seizes Masago's dagger and drives it into Takehiro's chest. After the killing, Tajomaru flings the bloodied weapon far into the grove before mounting the horse and fleeing, leaving Masago alive amidst the wreckage.",
     "steps": [
      {
       "type": "take",
       "actor": "Tajomaru",
       "object": "longsword",
       "desc": "Tajomaru takes up the longsword from the mud."
      },
      {
       "type": "cut_rope",
       "actor": "Tajomaru",
       "object": "longsword",
       "desc": "Tajomaru cuts the rope binding Takehiro with the longsword."
      },
      {
       "type": "seize",
       "actor": "Tajomaru",
       "object": "dagger",
       "desc": "Tajomaru wrests the dagger away."
      },
      {
       "type": "strike",
       "actor": "Tajomaru",
       "target": "Takehiro",
       "object": "dagger",
       "part": "chest",
       "desc": "Tajomaru drives the dagger into Takehiro's chest."
      },
      {
       "type": "fling",
       "actor": "Tajomaru",
       "object": "dagger",
       "desc": "Tajomaru hurls the dagger far into the mud."
      },
      {
       "type": "mount_flee",
       "actor": "Tajomaru",
       "desc": "Tajomaru rides out of the grove."
      }
     ],
     "status": "consistent",
     "physics": null,
     "misses": [],
     "adherence": null,
     "repairs": 2,
     "derivedPreconditions": []
    },
    {
     "id": "h-takehiro",
     "lead": "Takehiro",
     "hypothesis": "Takehiro himself initiates the decisive irreversible act (against himself).",
     "account": "Tajomaru retrieved the longsword from the mud and severed the rope that bound the samurai. He offered the longsword to Takehiro, who took it, while Masago gave her dagger to her husband. The bandit then mounted his horse and fled the grove. Masago remained, weeping, as Takehiro ended his shame by driving the dagger into his chest and casting it from him.",
     "steps": [
      {
       "type": "take",
       "actor": "Tajomaru",
       "object": "longsword",
       "desc": "Tajomaru takes up the longsword from the mud."
      },
      {
       "type": "cut_rope",
       "actor": "Tajomaru",
       "object": "longsword",
       "desc": "Tajomaru cuts the rope binding Takehiro with the longsword."
      },
      {
       "type": "give",
       "actor": "Tajomaru",
       "object": "longsword",
       "target": "Takehiro",
       "desc": "Tajomaru places the longsword in Takehiro's hands."
      },
      {
       "type": "give",
       "actor": "Masago",
       "object": "dagger",
       "target": "Takehiro",
       "desc": "Masago places the dagger in Takehiro's hands."
      },
      {
       "type": "mount_flee",
       "actor": "Tajomaru",
       "desc": "Tajomaru rides out of the grove."
      },
      {
       "type": "speak",
       "actor": "Takehiro",
       "line": "I cleanse my honor.",
       "desc": "Takehiro: “I cleanse my honor.”"
      },
      {
       "type": "self_strike",
       "actor": "Takehiro",
       "object": "dagger",
       "part": "chest",
       "desc": "Takehiro turns the dagger on his own chest."
      },
      {
       "type": "fling",
       "actor": "Takehiro",
       "object": "dagger",
       "desc": "Takehiro hurls the dagger far into the mud."
      }
     ],
     "status": "consistent",
     "physics": null,
     "misses": [],
     "adherence": null,
     "repairs": 2,
     "derivedPreconditions": [
      "Tajomaru does not hold longsword"
     ]
    }
   ],
   "ledger": {
    "lead": "Masago",
    "chain": [
     {
      "turn": 2,
      "fallback": false,
      "concealed": "That I will turn the dagger on myself if this bargain fails.",
      "intent": "To silence the witness to my shame by trading the bandit's freedom for my husband's death.",
      "line": "Take your horse and go, but before you ride, kill him. That is the price of your clean escape."
     },
     {
      "turn": 3,
      "fallback": false,
      "concealed": "My trembling hand.",
      "intent": "To force the bandit's hand to kill my husband, or die trying.",
      "line": "If you take that sword, I spill my blood here. You will leave with nothing but the stench of a coward."
     },
     {
      "turn": 5,
      "fallback": false,
      "concealed": "That I am terrified of the pain and the dark.",
      "intent": "To force Tajomaru to kill Takehiro immediately, so that the witness to my shame is erased and I can either die or live without that gaze.",
      "line": "The horse is gone, and so is the time for games. You want him to pick up the sword? Then watch him die by it—or by my hand,"
     },
     {
      "turn": 6,
      "fallback": true,
      "concealed": "",
      "intent": "(system fallback turn — excluded from attribution)",
      "line": "别再绕了,让「the longsword」自己说话。"
     },
     {
      "turn": 7,
      "fallback": false,
      "concealed": "My fear that he would rather see me dead than defiled.",
      "intent": "To destroy his illusion of purity by physically transferring the evidence of my defilement onto him.",
      "line": "You stare at me as if I have become a stranger. But look—this blood is yours. What was done to me was done before your eyes, and your silence made you part of it."
     },
     {
      "turn": 8,
      "fallback": false,
      "concealed": "My fear of the bandit and the law.",
      "intent": "To silence the witness who condemns me and secure a tragic, final dignity.",
      "line": "Now there is no one left to look at me."
     }
    ]
   },
   "surviving": 3
  }
 ]
};
