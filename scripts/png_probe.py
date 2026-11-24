#!/usr/bin/env python3
"""纯 python PNG 解码（zlib+unfilter）：采样原站截图颜色 + 裁剪彩色 logo。
用法：python scripts/png_probe.py
"""
import zlib, struct, sys

def read_png(path):
    d = open(path, 'rb').read()
    assert d[:8] == b'\x89PNG\r\n\x1a\n'
    pos, idat, w, h, bitd, ctype = 8, b'', 0, 0, 0, 0
    while pos < len(d):
        ln = struct.unpack('>I', d[pos:pos+4])[0]
        typ = d[pos+4:pos+8]
        data = d[pos+8:pos+8+ln]
        if typ == b'IHDR':
            w, h, bitd, ctype = struct.unpack('>IIBB', data[:10])
        elif typ == b'IDAT':
            idat += data
        elif typ == b'IEND':
            break
        pos += 12 + ln
    raw = zlib.decompress(idat)
    ch = {0:1, 2:3, 3:1, 4:2, 6:4}[ctype]
    stride = w * ch
    out = bytearray(w * h * ch)
    prev = bytearray(stride)
    pos = 0
    for y in range(h):
        f = raw[pos]; pos += 1
        line = bytearray(raw[pos:pos+stride]); pos += stride
        if f == 1:
            for i in range(ch, stride): line[i] = (line[i] + line[i-ch]) & 255
        elif f == 2:
            for i in range(stride): line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i-ch] if i >= ch else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i-ch] if i >= ch else 0
                b = prev[i]
                c = prev[i-ch] if i >= ch else 0
                p = a + b - c
                pa, pb, pc = abs(p-a), abs(p-b), abs(p-c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        out[y*stride:(y+1)*stride] = line
        prev = line
    return w, h, ch, out

def px(w, h, ch, buf, x, y):
    o = (y*w + x)*ch
    return buf[o], buf[o+1], buf[o+2]

def avg(w, h, ch, buf, x0, y0, x1, y1):
    n = r = g = b = 0
    for y in range(y0, y1):
        for x in range(x0, x1):
            p = px(w, h, ch, buf, x, y)
            r += p[0]; g += p[1]; b += p[2]; n += 1
    return '#%02x%02x%02x' % (r//n, g//n, b//n)

def main():
    src = r'E:/GIthub_Project/My_Shader/kira_shader/screenshots/re-work/ehealth-arena-0.png'
    w, h, ch, buf = read_png(src)
    print('size', w, h, 'ch', ch)
    print('paper A:', avg(w,h,ch,buf, 300,700, 500,780))
    print('paper B:', avg(w,h,ch,buf, 60,880, 300,960))
    print('close bg:', avg(w,h,ch,buf, 1465,18, 1550,44))
    print('title dark:', px(w,h,ch,buf, 100,160))
    # 找 logo 边界：左上角扫描非纸底像素
    paper = px(w,h,ch,buf, 400,700)
    def diff(p, q): return abs(p[0]-q[0])+abs(p[1]-q[1])+abs(p[2]-q[2])
    xs, ys = [], []
    for y in range(5, 70):
        for x in range(5, 260):
            if diff(px(w,h,ch,buf,x,y), paper) > 60:
                xs.append(x); ys.append(y)
    if xs:
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        print('logo bbox:', x0, y0, x1, y1)
        # 裁剪并写 BMP（免 PIL）放大 4x
        crop_w, crop_h = x1-x0+1, y1-y0+1
        S = 4
        bmp = bytearray()
        bw = crop_w*S*3 + (crop_w*S*3) % 4
        hdr = struct.pack('<2sIHHIIiiHH', b'BM', 14+40+crop_h*S*bw, 0,0, 14+40, 40, crop_w*S, crop_h*S, 1, 24, 0, 0, 0, 0, 0, 0)
        bmp += hdr
        for yy in range(crop_h*S-1, -1, -1):
            row = bytearray()
            for xx in range(crop_w*S):
                p = px(w,h,ch,buf, x0 + xx//S, y0 + yy//S)
                row += bytes((p[2], p[1], p[0]))
            row += b'\x00' * ((crop_w*S*3) % 4)
            bmp += row
        out = r'E:/GIthub_Project/My_Shader/kira_shader/public/work-media/logo-colored.bmp'
        import os
        os.makedirs(os.path.dirname(out), exist_ok=True)
        open(out, 'wb').write(bmp)
        print('logo bmp saved:', out)

if __name__ == '__main__':
    main()
