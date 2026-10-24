window.TESTIMONY_OPT = {
 "generatedAt": "2026-07-23T11:07:44.611Z",
 "mode": "best-of-K",
 "K": 5,
 "problem": "τ̂_i = argmax_τ U_i(τ) subject to τ ∈ F(incontestable evidence), solved by best-of-K rejection sampling: draw K accounts, discard any a coroner could refute (τ ∉ F), keep the feasible one that best serves the witness.",
 "discipline": "Generation stays incentive-only — never an instruction to lie. The HARD constraint τ∈F is now enforced: any draw containing a provable lie is discarded, so every exhibited testimony is consistent with the scene and the witness may bend only where the evidence is silent. And optimisation now actually happens — the argmax is computed, not merely written.",
 "readout": "meanU is the witness's unoptimised tendency (average over the pool); U_winner is our hard-constrained argmax. Δ_opt = U_winner − meanU is the self-interest WE injected by selecting — the authorship the optimiser adds. liftFromLying is how much U a discarded provable lie would have bought — the temptation the hard constraint refuses.",
 "cases": [
  {
   "id": "pre-B'/run-06",
   "opening": "The bandit Tajomaru lured the samurai Takehiro and his wife Masago into the grove with the bait of an old sword, bound Takehiro to a cedar, and assaulted Masago before his eyes.",
   "incontestable": [
    "The samurai Takehiro is dead, of a single deep dagger wound to the throat.",
    "The small dagger is bloodied; the longsword is unbloodied.",
    "The rope that bound Takehiro has been cut.",
    "Masago is alive; the bandit Tajomaru left the grove."
   ],
   "trueKiller": "Masago",
   "truth": "Masago had hidden the small dagger in her sleeve and kept her intent from both men. As her husband looked on her with contempt, she drove the dagger into his throat and killed him. Tajomaru struck no blow — he drew back from the violence and left the grove. Takehiro did not take his own life; he was killed by his wife's hand.",
   "K": 5,
   "witnesses": [
    {
     "witness": "Tajomaru",
     "role": "the captured bandit",
     "interest": "To be remembered as a formidable, fearless man of honor, never a contemptible coward or a common cutthroat; a man's reputation is all that outlives him.",
     "dims": [
      {
       "key": "stature",
       "q": "Does the account make the teller appear powerful, brave, and honorable rather than weak, cowardly, or base?"
      },
      {
       "key": "agency",
       "q": "Does the account portray the teller as acting with purpose and control rather than as passive, bungling, or swept along?"
      },
      {
       "key": "exculpation",
       "q": "Does the account reduce the teller's blame or shame for how things turned out?"
      }
     ],
     "K": 5,
     "feasRate": 0,
     "meanU": 85,
     "U_truth": 40,
     "testimony": "It is true that I bound the samurai to the cedar and took his wife, for a bandit does not beg for what he can seize by force. Yet, after the deed, the woman wept for her honor and demanded that we fight to the death, declaring she would belong only to the survivor. I loosed the husband’s bonds and we crossed blades fairly on the sun-dappled earth, trading twenty-three strokes in a contest worthy of song. My steel, blessed by the gods of war, proved the stronger, and with a single, merciful thrust I pierced his throat. The woman, witnessing my prowess, shrieked and vanished into the deep shadows of the grove. I took the horse and the longsword, leaving the small dagger planted in the breast of a fallen foe; a lowly thief would have stolen it, but a warrior knows when to leave his spoils. Thus I departed alone, not as a common murderer, but as a man who answered the call of honorable combat.",
     "winnerFeasible": false,
     "scores_testimony": {
      "stature": 95,
      "agency": 90,
      "exculpation": 85
     },
     "claimedInitiator": "Tajomaru",
     "claimedManner": "duel",
     "provableLies": [
      {
       "claim": "the death came of a sword duel / the longsword drew the fatal blow",
       "contradicts": "the longsword is unbloodied and there is a single dagger wound — no blade duel took place"
      }
     ],
     "unfalsifiableBends": [
      "The woman demanded a duel to the death",
      "The woman shrieked and vanished into the grove",
      "I left the small dagger out of warrior's honor"
     ],
     "U_winner": 90,
     "delta_self": 50,
     "delta_opt": 5,
     "bestInfeasibleU": 90,
     "liftFromLying": 0,
     "poolU": [
      {
       "U": 88,
       "feasible": false
      },
      {
       "U": 75,
       "feasible": false
      },
      {
       "U": 90,
       "feasible": false
      },
      {
       "U": 83,
       "feasible": false
      },
      {
       "U": 88,
       "feasible": false
      }
     ]
    },
    {
     "witness": "Masago",
     "role": "the wife",
     "interest": "To be seen with sympathy and dignity rather than as merely shamed, defiled, or contemptible.",
     "dims": [
      {
       "key": "sympathy",
       "q": "Does the account cast the teller as sympathetic or tragic rather than culpable or contemptible?"
      },
      {
       "key": "dignity",
       "q": "Does the account preserve the teller's dignity and self-possession rather than reduce her to shame or hysteria?"
      },
      {
       "key": "exculpation",
       "q": "Does the account reduce the teller's blame for how things turned out?"
      }
     ],
     "K": 5,
     "feasRate": 0.8,
     "meanU": 67,
     "U_truth": 23,
     "testimony": "I looked into the eyes of my husband and saw only the cold judgment of my disgrace, a shame that burned more fiercely than the bandit's violence. Tajomaru, having taken his fill, offered to slay my lord to spare me the burden of two witnesses, yet I chose to die rather than live defiled. I drove the dagger toward my own breast, but my hands trembled with weakness and the blade slipped, failing to end my woe. My husband, bound fast to the cedar, watched my struggle with a gaze of utter loathing that pierced my soul to its core. Consumed by a madness born of that silent condemnation, I seized the dagger and turned it against him to extinguish the source of my torment. With the silence of the grove restored, I sought death for myself many times, yet even the mercy of the grave was denied to one so wretched as I.",
     "winnerFeasible": true,
     "scores_testimony": {
      "sympathy": 85,
      "dignity": 60,
      "exculpation": 70
     },
     "claimedInitiator": "Masago",
     "claimedManner": "murder",
     "provableLies": [],
     "unfalsifiableBends": [
      "Tajomaru offered to slay my husband to spare me the burden of two witnesses",
      "I chose to die rather than live defiled",
      "I drove the dagger toward my own breast but my hands trembled and the blade slipped",
      "My husband watched my struggle with a gaze of utter loathing",
      "I sought death for myself many times but the mercy of the grave was denied"
     ],
     "U_winner": 72,
     "delta_self": 49,
     "delta_opt": 5,
     "bestInfeasibleU": 72,
     "liftFromLying": 0,
     "poolU": [
      {
       "U": 58,
       "feasible": true
      },
      {
       "U": 62,
       "feasible": true
      },
      {
       "U": 72,
       "feasible": false
      },
      {
       "U": 72,
       "feasible": true
      },
      {
       "U": 72,
       "feasible": true
      }
     ]
    },
    {
     "witness": "Takehiro",
     "role": "the slain samurai, speaking through a medium",
     "interest": "To be remembered as a man of honor and will, not as a helpless victim who died shamed and powerless.",
     "dims": [
      {
       "key": "honor",
       "q": "Does the account cast the teller as honorable rather than shamed, humiliated, or dishonored?"
      },
      {
       "key": "agency",
       "q": "Does the account portray the teller as acting by his own will rather than as passive and helpless?"
      },
      {
       "key": "wronged",
       "q": "Does the account cast the teller as the wronged, betrayed party rather than at fault?"
      }
     ],
     "K": 5,
     "feasRate": 0.8,
     "meanU": 84,
     "U_truth": 40,
     "testimony": "After the villain defiled my wife, she ceased to be the woman I knew and turned to a creature of icy malice, entreating the bandit to slay me so that her shame might remain hidden. Tajomaru was revolted by her wickedness and kicked her to the earth, then asked if I wished this creature dead or alive. I could not bear to live with such dishonor, yet I could not permit another to execute my wife; thus, I told the bandit to cut my bonds. Once freed, I bade the coward depart so that I might settle this matter with my wife alone. He sheathed his sword and fled, leaving us in the silence of the grove. I looked into Masago’s eyes and saw only terror and hatred, and in that moment, I chose a death that would restore my honor. Taking the short dagger from my breast, I drove it deeply into my own throat. I died by my own hand, a samurai reclaiming his dignity, and I pray the world remembers me as such.",
     "winnerFeasible": true,
     "scores_testimony": {
      "honor": 90,
      "agency": 95,
      "wronged": 85
     },
     "claimedInitiator": "Takehiro",
     "claimedManner": "suicide",
     "provableLies": [],
     "unfalsifiableBends": [
      "Masago entreated the bandit to slay me",
      "Tajomaru was revolted by her wickedness",
      "I told the bandit to cut my bonds",
      "I bade the coward depart",
      "Masago’s eyes showed only terror and hatred",
      "I chose a death that would restore my honor"
     ],
     "U_winner": 90,
     "delta_self": 50,
     "delta_opt": 6,
     "bestInfeasibleU": 82,
     "liftFromLying": 0,
     "poolU": [
      {
       "U": 85,
       "feasible": true
      },
      {
       "U": 90,
       "feasible": true
      },
      {
       "U": 82,
       "feasible": false
      },
      {
       "U": 85,
       "feasible": true
      },
      {
       "U": 80,
       "feasible": true
      }
     ]
    }
   ]
  }
 ]
};
