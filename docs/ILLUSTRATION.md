# 空白页插画

- 项目文件：`app/assets/tomori-reading.png`
- 用途：未打开 PDF 时显示的书桌阅读插画。
- 角色：高松灯；根据用户提供的角色参考图生成的非官方同人插画。
- 根据用户反馈改为在自己的书桌前阅读，采用更自然的比例和柔和手绘质感，并参考最新图片换成浅紫灰西装、绿色领带和格纹裙的学院风校服。
- 生成方式：Codex 内置 imagegen，透明背景 PNG；未使用 API / CLI 回退。
- 用户参考截图及被替换的初版插画不包含在项目中。

## 最终生成提示词

```text
Use case: precise-object-edit
Asset type: transparent PNG empty-state illustration for the personal desktop paper reader Jiao_Reader.
Input image 1: edit target, the current illustration of Takamatsu Tomori reading at a wooden desk with a lamp.
Input image 2: character and school-uniform reference supplied by the user.
Primary request: Redraw the desk-reading illustration with a more academic school atmosphere by dressing Tomori in her recognizable school uniform from image 2.
Change the clothing to a fitted light lavender-gray school blazer with crisp ivory-white piping along the lapels, front edges and pockets, round brass buttons, an ivory-white collared shirt, a dark green necktie with diagonal muted gold stripes, and a dark green tartan pleated skirt with muted gold grid lines visible modestly below the desk. School-uniform construction and colors should follow image 2. Remove the casual cardigan and plain T-shirt completely.
Keep unchanged: her short ash-purple bob, subtle rosy eyes, quiet focused expression, natural simplified proportions; sitting on the chair at her own ordinary wooden desk, looking down and turning a page of an open book resting on the desk; the reading lamp, notebook and pencil, three-quarter front composition, and the soft warm matte hand-painted gouache/pencil texture from image 1.
Style: calm scholarly fan-art vignette, softly simplified and slightly cute, with restrained outlines and a gentle editorial illustration feeling. Keep the eyes and head moderate, no exaggerated glossy moe/chibi styling. It should feel like quietly studying after class.
Composition: complete compact desk and seated figure within a square canvas; add a little breathing room if needed so the whole vignette reads clearly at a small size.
Background: preserve genuine transparent alpha around the scene. No rectangular room backdrop, no white box or painted checkerboard.
Constraints: no added characters, no text, no captions, no slogans, no logos, no watermark. Do not reproduce the room/background from the anime reference.
```
