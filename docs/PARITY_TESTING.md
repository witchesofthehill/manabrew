# Parity Testing Guide

How to run parity tests comparing the Rust engine against the Java Forge
reference implementation.

## Prerequisites

1. **Java 18** (Zulu recommended):

   ```bash
   export JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-18.jdk/Contents/Home
   ```

## How to run a parity test

### 1. Import the deck you intend to test

Create a file `my_deck.json` inside the `parity_decks/` root directory of the project.
Look at existing decks in that folder for reference on the expected JSON format.

### 2. Run the command

The following command will run a single matchup between `my_deck` and itself, using a fixed seed and max turn limit. Adjust the parameters as needed.

```bash
yarn parity:test \
  --seed 42 \
  --deck1 my_deck \
  --deck2 my_deck \
  --max-turns 10
```

## Interpreting Results

- **PASS**: Rust and Java produce identical game state snapshots at each turn
- **FAIL**: Divergence detected. The output shows the first turn where states
  differ, with details on the mismatched fields.

The flag `--full-log` is especially usefull for debugging, as it outputs a full log of all the decisions and callbacks both engines made during the game, displayed side by side.
