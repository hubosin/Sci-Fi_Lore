The universe has one **Canon** history up to the Conglomerate's compromise offer, then splits into possible endings. A couple of side-branches split off earlier and either rejoin Canon or end badly.

## Timeline tags

Every story and event is tagged with the timeline it belongs to.

| Tag | Name | What it means | Page |
|---|---|---|---|
| **Canon** | Main timeline | The shared history everyone agrees on (up to the compromise offer). | [Canon Timeline](Timeline-Canon) |
| **I-Line** | Bomb timeline | A bomb is sent after the Remnant fleet and is stopped before it reaches it. **Rejoins Canon**; events before and after it are identical to Canon. | [I-Line](Timeline-I-Line) |
| **RHV** | Remnant-Human Victory | The Remnant-Human alliance refuses the offer and wins the war at Earth. | [RHV Timeline](Timeline-RHV) |
| **EACO** | Earth Accepts Conglomerate Offer | Humanity accepts the offer, joins the Conglomerate and gives up Earth's resources. | [EACO Timeline](Timeline-EACO) |
| **Red Line** | Worst case | Humans destroy the Remnants, then lose to the Conglomerate alone. | [Red Line](Timeline-Red-Line) |
| **N/A** | Unattached | Doesn't depend on any branch (e.g. other star systems). | — |

## Branch map

Grey = Canon · Blue = I-Line · Red = worst case · Orange = possible endings.

```mermaid
flowchart TD
    A["Conglomerate deems the Remnants unfit;<br/>genocide & strip-mine their planet.<br/>Priority members evacuated"]
    B["Remnant survivors make an uncalculated jump,<br/>landing near our solar system"]
    C["Human probe near Jupiter<br/>spots the Remnant fleet (Sept 1984)"]
    D["US & USSR warships deployed<br/>to intercept the fleet"]
    E["Remnant convoy reaches Earth;<br/>battle — humans win"]
    F["Contact established: science,<br/>history & language exchanged"]
    G["Humans escort the Remnants;<br/>holding pattern over Mars"]
    H["Remnant-Human alliance;<br/>second industrial age"]
    I["Solar gravitational telescope confirms<br/>Conglomerate fleet — great war begins"]
    J{"Conglomerate offers a compromise:<br/>join, fight the bigger threat,<br/>give up Earth's resources"}

    I1["Small probe carrying a bomb<br/>sent at the Remnant ship"]
    I2["Bomb disarmed / detonated early"]

    R1["Bomb detonates / human fleet attacks —<br/>Remnants go extinct"]
    R2["Conglomerate deems humans unfit;<br/>war with Earth"]

    END1(["Earth loses — humanity wiped out,<br/>Earth stripped (Red Line)"])
    END2(["Humans accept & join the Conglomerate<br/>(EACO)"])
    END3(["Earth wins at Earth; surface in ruin<br/>(RHV)"])

    A --> B --> C
    C --> D --> E
    C --> E
    E --> F --> G --> H --> I --> J

    E --> I1 --> F
    F --> I2 --> G

    F --> R1 --> R2 --> END1
    J --> END1
    J --> END2
    J --> END3

    classDef canon fill:#eeeeee,stroke:#555,color:#111
    classDef iline fill:#d7f0f2,stroke:#138a95,color:#111
    classDef red fill:#f6d5d5,stroke:#a11,color:#111
    classDef ending fill:#fde6c8,stroke:#e8912c,color:#111
    class A,B,C,D,E,F,G,H,I,J canon
    class I1,I2 iline
    class R1,R2,END1 red
    class END2,END3 ending

    linkStyle 4,10,11,12,13 stroke:#138a95,stroke-width:2px
    linkStyle 14,15,16,17 stroke:#a11,stroke-width:2px
    linkStyle 18,19 stroke:#e8912c,stroke-width:2px
```

## Dated events

The full date-by-date history is on the [Canon Timeline](Timeline-Canon).
