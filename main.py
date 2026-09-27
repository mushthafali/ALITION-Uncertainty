import sys
import os
import webview  # type: ignore  # pywebview installed via pip, not in global site-packages

def get_base_path():
    """Get absolute path to resource, works for dev and for PyInstaller"""
    # Menggunakan getattr untuk mencegah error pada linter (seperti Pyrefly) 
    # karena atribut _MEIPASS hanya ada saat dijalankan sebagai exe.
    return getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))

base_dir = get_base_path()
sys.path.append(os.path.join(base_dir, 'src'))

from alition.api import AlitionAPI

def main():
    api = AlitionAPI()
    
    web_dir = os.path.join(base_dir, 'src', 'alition', 'web')
    index_path = os.path.join(web_dir, 'index.html')
    
    # Ensure logo asset is synchronized to web assets directory
    src_logo = os.path.join(base_dir, 'img', 'logo.png')
    web_img_dir = os.path.join(web_dir, 'img')
    dst_logo = os.path.join(web_img_dir, 'logo.png')
    if os.path.exists(src_logo):
        try:
            os.makedirs(web_img_dir, exist_ok=True)
            import shutil
            if not os.path.exists(dst_logo) or os.path.getmtime(src_logo) > os.path.getmtime(dst_logo):
                shutil.copy2(src_logo, dst_logo)
        except Exception:
            pass
    
    webview.create_window(
        title='Alition',
        url=index_path,
        js_api=api,
        width=1300,
        height=900,
        min_size=(900, 650),
        background_color='#f0f3f7',
        frameless=True,
        easy_drag=False
    )
    
    webview.start(debug=False)

if __name__ == '__main__': 
    main()
