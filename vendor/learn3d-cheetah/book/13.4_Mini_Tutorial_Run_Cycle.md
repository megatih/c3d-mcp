<!--{"parent": "13_Character_Animation.md", "order": 4}-->

## Mini-Tutorial: Run Cycle

> **Note:** the original edition had four keyframe figures here (Compress, Takeoff, Passing, and Touchdown, in the style of the walk cycle's), but they were lost. Render them again from the character rig. <!-- TODO screenshot -->

Run cycles are much more difficult to get right than walk cycles. This is because a run cycle involves much more sudden movements (a runner is essentially jumping from one foot to the other and then back again). A run cycle will generally be shorter than a walk cycle.

The key underlying insight when animating a run cycle is that running is really a series of alternating one-legged jumps (think of the way the tentacle moves) whereas walking is a series of balance-shifts.

> **Note:** the tentacle in [Character Animation Tutorials](/13.1_Character_Animation_Tutorials/) only curls; it never jumps. Explain the comparison, or drop the parenthesis. <!-- TODO editorial -->

As a starting point, I’d suggest making a 0.6s take (let’s call it “run cycle”). You’ll want four base keyframes, but they’re not going to be evenly spaced. We’ll call them “Compress”, “Takeoff”, “Passing”, and “Touchdown”, and try putting them on frames 0, 1, 4, and 7. Then copy frame 0 to frames 9 and 18, and frames 1, 4, and 7 to 10, 13, and 16 respectively. Then you need to “flip” frames 9, 10, 13, and 16.

> **AI draft:** written to complete this tutorial, following the conventions of the walk cycle tutorial; check the poses against your own rig. <!-- TODO review AI draft -->

This tutorial builds on [Tutorial: Walk Cycle](/13.3_Tutorial_Walk_Cycle/), so do that one first: it covers the Takes pane, recording keyframes with hierarchy toggled on, copying and pasting the blue keyframe markers, and flipping poses with **Pose Utilities**. The frame numbers here, like the walk cycle's, assume 30 frames per second (set under **Animation \> Frames per Second**), so the 0.6s take runs from frame 0 to frame 18.

> **Note:** check that 30 fps is the default for new scenes in 8.1.1. <!-- TODO verify -->

### The four poses

Each half of the cycle is one stride: the character pushes off one foot, flies, and lands on the other. The poses below are seen from the **Left** view, with the right foot on the ground at frame 0.

* **Compress** (frame 0): the right foot is planted under the body and the right knee is deeply bent, absorbing the landing. The hips are at their lowest. The left leg is folded up behind, its knee swinging forward past the right knee.

* **Takeoff** (frame 1): the right leg straightens behind the body, pushing off from the ball of the foot. The left thigh drives forward and up. The hips start to rise.

* **Passing** (frame 4): both feet are off the ground and the hips are at their highest. The right leg trails behind, folding up at the knee. The left leg reaches forward, ready to land.

* **Touchdown** (frame 7): the left foot lands a little ahead of the hips and the left leg is almost straight. The right leg is still behind, bent.

Two things hold for every pose. The torso leans forward more than in the walk, and the faster the run, the more it leans. The arms swing opposite to the legs, bent at the elbow: when the left leg is forward, so is the right arm.

### Steps

1. Right-click in the Takes pane and create a new take. Name it “run cycle” and set its duration to 0.6 (seconds).

2. Go to frame 0, switch the view to **Left**, and pose the **Compress** keyframe. Click the root bone and then click **Record**.

3. Pose and record **Takeoff** on frame 1, **Passing** on frame 4, and **Touchdown** on frame 7, clicking the root bone before each **Record**.

4. Click the blue marker for frame 0 and copy it. Paste it on frames 9 and 18. Then copy frame 1 to frame 10, frame 4 to frame 13, and frame 7 to frame 16.

5. Flip frames 9, 10, 13, and 16. For each one, go to the frame, click the root bone, choose **Swap Left and Right** in **Pose Utilities**, click the root bone *again*, and click **Record**. Leave frame 18 alone: it must match frame 0 so the cycle loops.

Play the take. Like the walk cycle, the character runs on the spot, so the planted foot should slide backwards between Touchdown and Takeoff. A game engine moves the character forward at the matching speed.

Now tweak. The commonest problems are a run that looks floaty (bring Touchdown earlier, so the character spends less time in the air) and a character that doesn’t seem to bear weight (push the Compress further, and keep the head from bobbing as much as the hips).

> *End of AI draft.* <!-- /AI draft -->
