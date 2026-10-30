<!--{"order": 12}-->

# Rendering

![](/images/pastedGraphic-537.jpg)

> **AI draft:** generated from the Cheetah 3D 8.1.1 manual; not yet reviewed by the author. <!-- TODO review AI draft -->

Rendering is the process of creating high quality images from 3D scenes. Cheetah 3D 8 has two built-in render engines, and you choose between them with **Render \> Renderer** (or by clicking and holding the renderer icon in the toolbar):

- **Cheetah** is a recursive raytracer (with irradiance caching and photon maps for radiosity and caustics). It has been Cheetah 3D’s renderer for well over a decade, and “ray tracing” is probably the most widely used rendering algorithm for non-realtime rendering.

- **Falcon**, introduced in Cheetah 3D 7, is an unbiased path tracer. It traces many random light paths per pixel, so it handles bounced light, glossy reflections, and soft shadows naturally, at the cost of noise that goes away as you add samples. Falcon is where future development is focused.

(Cheetah 3D’s 3D views are rendered using realtime techniques, which are much faster than either renderer but much lower in quality.)

> *End of AI draft.* <!-- /AI draft -->

In order to render an image in Cheetah 3D you must already have:

1. created a scene

2. placed a camera such that it is pointing at whatever it is you want to render (you can both move and rotate cameras, and change their field of view to control the composition of a render),

3. ideally you should have lit the scene, placed materials on the models, and so on, but these aren’t compulsory

![](/images/pastedGraphic-538.jpg)

> **Note:** this screenshot shows an older version of Cheetah 3D. <!-- TODO screenshot -->

> **AI draft:** generated from the Cheetah 3D 8.1.1 manual; not yet reviewed by the author. <!-- TODO review AI draft -->

*Cheetah 3D’s toolbar buttons for rendering. The Render button renders a still image of the scene as it currently is, while the Animation button renders an animation of the current selection of frames in the current take. A third button starts a texture baking job (see [Baking Materials](/11.15_Baking_Materials/)).*

To render a scene, simply click the render button for a still image or the animation button for an animated scene (or use **Render \> Render**).

> *End of AI draft.* <!-- /AI draft -->

The **Render Manager** window will immediately appear, showing you the progress of your rendering (along with past renders, possibly including past renders still being processed).

Cheetah 3D divides rendering jobs into square “buckets” to efficiently divide a rendering task among all the CPUs in your computer. (Some Macs have Intel CPUs that support hyperthreading, which makes each CPU look like two CPUs to the operating system, and Cheetah 3D too — on those Macs you’ll see twice as many rendering buckets as you have CPUs.)

**Note**: when rendering an animation, Cheetah 3D will “lock up” the file used to render the image. If you want to keep working on an animation while it’s being rendered you should save a copy of the file and render the copy. This issue does not occur when rendering single frames.

<!-- toc -->
- [The Camera Object](/11.1_The_Camera_Object/)
- [Projection Settings](/11.2_Projection_Settings/)
- [The Render Tag](/11.3_The_Render_Tag/)
- [Dealing with Reality](/11.4_Dealing_with_Reality/)
- [Simple Render Setups](/11.5_Simple_Render_Setups/)
- [Rendering Panoramas](/11.6_Rendering_Panoramas/)
- [Rendering a Sky Box](/11.7_Rendering_a_Sky_Box/)
- [How Raytracing Works](/11.8_How_Raytracing_Works/)
- [Environments](/11.9_Environments/)
- [Rendering Reflected Lights](/11.10_Rendering_Reflected_Lights/)
- [Cartoon Looks](/11.11_Cartoon_Looks/)
- [Render Manager](/11.12_Render_Manager/)
- [Creating your own HDRIs for Image-Based Lighting](/11.13_Creating_your_own_HDRIs_for_Image_Based_Lighting/)
- [Rendering Tricks](/11.14_Rendering_Tricks/)
- [Baking Materials](/11.15_Baking_Materials/)
<!-- /toc -->
