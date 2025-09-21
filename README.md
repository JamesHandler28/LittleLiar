# littleliar

A multiplayer social deduction game of trust and betrayal, inspired by Clue Conspiracy. This game is built with Node.js, Express, and Socket.IO.

**Play the live game here: https://www.littleliar.xyz**

---

## Gameplay

*littleliar* is a game for 3-10 players, divided into two secret teams: the **Friends** and the **Conspiracy**.

* **The Friends' Goal:** Work together to explore dangerous locations and disarm traps to keep a VIP alive.
* **The Conspiracy's Goal:** Secretly sabotage the Friends' missions, wound the VIP, and enact a secret plot to eliminate them.

The game is played with a host (who views the main game board) and players who join via their mobile devices.

### Key Features
* Real-time online multiplayer.
* Secret roles with unique win conditions.
* Dynamic game board for hosts to display on a larger screen.
* Interactive player interface for voting, choosing teams, and disarming traps.

---

### Running the Project Locally

To run this project on your own computer:

1.  **Clone the repository:**
    ```bash
    git clone [https://github.com/JamesHandler28/LittleLiar.git](https://github.com/JamesHandler28/LittleLiar.git)
    ```
2.  **Navigate to the project directory:**
    ```bash
    cd LittleLiar
    ```
3.  **Install dependencies:**
    ```bash
    npm install
    ```
4.  **Start the server:**
    ```bash
    node server.js
    ```
5.  Open a browser and go to `http://localhost:3000` to start or join a game.
