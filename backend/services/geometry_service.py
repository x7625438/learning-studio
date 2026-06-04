import re


def normalize_diagram_svg(svg_text: str) -> str:
    text = str(svg_text or '').strip()
    if not text:
        return ''
    match = re.search(r'<svg[\s\S]*?</svg>', text)
    if not match:
        return ''
    svg = match.group(0)
    svg = re.sub(r'<script[\s\S]*?</script>', '', svg, flags=re.IGNORECASE)
    svg = re.sub(r'on\w+="[^"]*"', '', svg)
    svg = re.sub(r'on\w+=\'[^\']*\'', '', svg)
    if 'viewBox=' not in svg:
        svg = svg.replace('<svg', '<svg viewBox="0 0 320 240"', 1)
    if 'xmlns=' not in svg:
        svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"', 1)
    return svg


def looks_like_geometry_question(text: str) -> bool:
    normalized = str(text or '')
    geometry_markers = ('如图', '△', '三角形', '四边形', '圆', '点', '线段', '角', '∠')
    return any(marker in normalized for marker in geometry_markers)


def render_canonical_geometry_svg(question_text: str) -> str:
    normalized = re.sub(r'\s+', '', str(question_text or ''))
    if '圆O' in normalized and ('AB是直径' in normalized or 'AB为直径' in normalized) and '点C在圆' in normalized:
        return '''<svg width="100%" height="auto" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240">
  <rect width="320" height="240" fill="#fffaf0"/>
  <circle cx="160" cy="120" r="82" fill="none" stroke="#3f3f46" stroke-width="2.8"/>
  <path d="M78 120 L242 120" fill="none" stroke="#3f3f46" stroke-width="2.8"/>
  <path d="M78 120 L176 40 L242 120" fill="none" stroke="#3f3f46" stroke-width="2.4"/>
  <circle cx="78" cy="120" r="3.5" fill="#3f3f46"/>
  <circle cx="242" cy="120" r="3.5" fill="#3f3f46"/>
  <circle cx="176" cy="40" r="3.5" fill="#3f3f46"/>
  <circle cx="160" cy="120" r="3" fill="#f97316"/>
  <text x="66" y="143" text-anchor="middle" font-size="15" fill="#27272a">A</text>
  <text x="254" y="143" text-anchor="middle" font-size="15" fill="#27272a">B</text>
  <text x="176" y="27" text-anchor="middle" font-size="15" fill="#27272a">C</text>
  <text x="160" y="111" text-anchor="middle" font-size="14" fill="#ea580c">O</text>
</svg>'''

    if '四边形ABCD' in normalized:
        return '''<svg width="100%" height="auto" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240">
  <rect width="320" height="240" fill="#fffaf0"/>
  <path d="M70 55 L250 55 L220 190 L45 190 Z" fill="none" stroke="#3f3f46" stroke-width="2.8"/>
  <path d="M70 45 L250 45" fill="none" stroke="#f97316" stroke-width="2" stroke-dasharray="5 5"/>
  <path d="M45 202 L220 202" fill="none" stroke="#f97316" stroke-width="2" stroke-dasharray="5 5"/>
  <circle cx="70" cy="55" r="3.5" fill="#3f3f46"/>
  <circle cx="250" cy="55" r="3.5" fill="#3f3f46"/>
  <circle cx="220" cy="190" r="3.5" fill="#3f3f46"/>
  <circle cx="45" cy="190" r="3.5" fill="#3f3f46"/>
  <text x="62" y="38" text-anchor="middle" font-size="15" fill="#27272a">A</text>
  <text x="260" y="38" text-anchor="middle" font-size="15" fill="#27272a">B</text>
  <text x="232" y="213" text-anchor="middle" font-size="15" fill="#27272a">C</text>
  <text x="31" y="213" text-anchor="middle" font-size="15" fill="#27272a">D</text>
</svg>'''

    if '△ABC' not in normalized and '三角形ABC' not in normalized:
        return ''

    # Match D on BC: 点D在BC上 / 点D在边BC上 / D是BC的中点 / D为BC中点 / 点D是BC边的中点 / D是BC上一点 ...
    has_d_on_bc = bool(re.search(r'(点?D在(边)?BC上|D[是为]BC(边)?的?(中点|上一点))', normalized))
    is_d_midpoint = bool(re.search(r'D[是为]BC(边)?的?中点', normalized))
    has_connect_ad = '连接AD' in normalized
    # Match E on AB: similar patterns
    has_e_on_ab = bool(re.search(r'(点?E在(边)?AB上|E[是为]AB(边)?的?(中点|上一点))', normalized))
    is_e_midpoint = bool(re.search(r'E[是为]AB(边)?的?中点', normalized))
    # Match F on AC: similar patterns
    has_f_on_ac = bool(re.search(r'(点?F在(边)?AC上|F[是为]AC(边)?的?(中点|上一点))', normalized))
    is_f_midpoint = bool(re.search(r'F[是为]AC(边)?的?中点', normalized))
    has_extend_to_d = '延长BC到D' in normalized or '延长CB到D' in normalized or ('点D在BC的延长线' in normalized)

    base_line = '<path d="M35 205 L285 205" fill="none" stroke="#3f3f46" stroke-width="2.8"/>'
    if has_extend_to_d:
        base_line = '<path d="M35 205 L300 205" fill="none" stroke="#3f3f46" stroke-width="2.8"/>'

    extra_segments = []
    extra_points = []
    extra_labels = []

    if has_d_on_bc:
        # Midpoint of BC: (160, 205); general point on BC: (200, 205)
        d_cx = '160' if is_d_midpoint else '200'
        d_label_x = '148' if is_d_midpoint else '214'  # label centered above point
        extra_points.append(f'<circle cx="{d_cx}" cy="205" r="3.5" fill="#3f3f46"/>')
        extra_labels.append(f'<text x="{d_label_x}" y="198" text-anchor="middle" font-size="15" fill="#27272a">D</text>')
    elif has_extend_to_d:
        extra_points.append('<circle cx="300" cy="205" r="3.5" fill="#3f3f46"/>')
        extra_labels.append('<text x="312" y="226" text-anchor="middle" font-size="15" fill="#27272a">D</text>')
        extra_segments.append('<path d="M285 205 L300 205" fill="none" stroke="#3f3f46" stroke-width="2.8" stroke-dasharray="4 4"/>')

    if has_connect_ad and has_d_on_bc:
        # Line from A(160,40) to D on BC
        d_cx = '160' if is_d_midpoint else '200'
        extra_segments.append(f'<path d="M160 40 L{d_cx} 205" fill="none" stroke="#3f3f46" stroke-width="2.8"/>')

    if has_e_on_ab:
        # Midpoint of AB: (98, 123); general point on AB: (120, 93)
        e_cx = '98' if is_e_midpoint else '120'
        e_cy = '123' if is_e_midpoint else '93'
        e_label_x = str(int(e_cx)) if is_e_midpoint else '120'
        e_label_y = str(int(e_cy) - 7) if is_e_midpoint else '86'
        extra_points.append(f'<circle cx="{e_cx}" cy="{e_cy}" r="3.5" fill="#3f3f46"/>')
        extra_labels.append(f'<text x="{e_label_x}" y="{e_label_y}" text-anchor="middle" font-size="15" fill="#27272a">E</text>')
        extra_segments.append(f'<path d="M35 205 L{e_cx} {e_cy}" fill="none" stroke="#3f3f46" stroke-width="2.4"/>')

    if has_f_on_ac:
        # Midpoint of AC: (223, 123); general point on AC: (210, 106)
        f_cx = '223' if is_f_midpoint else '210'
        f_cy = '123' if is_f_midpoint else '106'
        f_label_x = str(int(f_cx) + 14) if is_f_midpoint else '224'
        f_label_y = str(int(f_cy)) if is_f_midpoint else '106'
        extra_points.append(f'<circle cx="{f_cx}" cy="{f_cy}" r="3.5" fill="#3f3f46"/>')
        extra_labels.append(f'<text x="{f_label_x}" y="{f_label_y}" text-anchor="middle" font-size="15" fill="#27272a">F</text>')
        extra_segments.append(f'<path d="M285 205 L{f_cx} {f_cy}" fill="none" stroke="#3f3f46" stroke-width="2.4"/>')

    return f'''<svg width="100%" height="auto" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240">
  <rect width="320" height="240" fill="#fffaf0"/>
  <path d="M35 205 L160 40 L285 205" fill="none" stroke="#3f3f46" stroke-width="2.8"/>
  {base_line}
  {''.join(extra_segments)}
  <circle cx="160" cy="40" r="3.5" fill="#3f3f46"/>
  <circle cx="35" cy="205" r="3.5" fill="#3f3f46"/>
  <circle cx="285" cy="205" r="3.5" fill="#3f3f46"/>
  {''.join(extra_points)}
  <text x="160" y="28" text-anchor="middle" font-size="15" fill="#27272a">A</text>
  <text x="24" y="226" text-anchor="middle" font-size="15" fill="#27272a">B</text>
  <text x="296" y="226" text-anchor="middle" font-size="15" fill="#27272a">C</text>
  {''.join(extra_labels)}
</svg>'''
