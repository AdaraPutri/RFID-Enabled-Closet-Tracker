# Project Logs

## Log 1: The Vision & Hardware Constraints
**Date:** September 6-9, 2026  

### Potential Issues
* **Signal bleeding:** UHF waves pass through wood and scan random clothes outside the closet.
* **Shadowing:** Packed clothes block the signal from hitting tags in the middle.
* **Power draw:** The UHF reader pulls too much power for the Arduino pins to handle alone.
* **Voltage mismatch:** Arduino runs on 5V, but the UHF reader needs 3.3V lines.

### Current Solution
* Either cover one cabinet with tin foil wrap or paint a cardboard with RFID paint along the sides, and mount the single antenna on the front edge of the ceiling pointing straight down.
  -> Blocks the radio waves from passing through the wood, and creates an invisible radio "curtain" at the opening to stop the signal from blasting straight out into the room.
* Designing a slightly spaced-out rack setup.
  -> Leaving small gaps between hangers prevents tightly packed clothes from blocking the signals from hitting tags in the middle. Only placing UHF-sewn clothing hanged instead of folded at the bottom.
* Using an external power source.
  -> Feeds power directly from a wall adapter so the reader doesn't overload and crash my Arduino.
* Using a logic level converter.
  -> Safely steps down the Arduino’s 5V data signals to the 3.3V lines the UHF module needs so I don't fry it.

![Initial Diagram Sketch](InitialDiagram.pdf)
