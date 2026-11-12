#!/usr/bin/env python3
# build_xaml.py - generates NoesisProject/AcademyPanel.xaml for the Creator Academy panel.
# Root Grid > Viewbox > fixed Canvas. One shared screen with six panes toggled by {Binding view}.
# Every binding here matches a field AcademyPanel.ts sets on the dataContext. Plain ASCII.
#   python3 build_xaml.py <out_xaml_path>
import sys

CW, CH = 1480, 840
# palette (ARGB)
BRAND = '#FF3B4BE0'; INK = '#FF1F293C'; SOFT = '#FF687791'; LINE = '#FFDBE1EC'
CARD = '#FFFFFFFF'; WASH = '#FFEFF2FB'; APPBG = '#FFEAEEF6'; RAIL = '#FF151B2E'
GREEN = '#FF2EB88A'; AMBER = '#FFF0A828'; RED = '#FFE24C5C'
SEC = {'0': '#FFE87D0D', '1': '#FF31A8FF', '2': '#FF7D2AE8', '3': '#FF0A84FF'}
SECNAME = {'0': 'Blender', '1': 'Photoshop', '2': 'Canva', '3': 'Horizon'}

out = []
def w(s=''): out.append(s)

def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

# ---------------------------------------------------------------- building blocks
def text(x, y, s, size, color=INK, bold=True, w_=None, wrap=False, align=None, name=None):
    extra = ''
    if w_ is not None:
        extra += ' Width="%d"' % w_
        if wrap:
            extra += ' TextWrapping="Wrap"'
    if align:
        extra += ' TextAlignment="%s"' % align
    if name:
        extra += ' x:Name="%s"' % name
    fw = 'Bold' if bold else 'Normal'
    return ('<TextBlock Canvas.Left="%d" Canvas.Top="%d" Text="%s" FontSize="%d" Foreground="%s" '
            'FontWeight="%s"%s/>') % (x, y, esc(s), size, color, fw, extra)

def bind_text(x, y, binding, size, color=INK, bold=True, w_=None, wrap=False, align=None):
    extra = ''
    if w_ is not None:
        extra += ' Width="%d"' % w_
        if wrap:
            extra += ' TextWrapping="Wrap"'
    if align:
        extra += ' TextAlignment="%s"' % align
    fw = 'Bold' if bold else 'Normal'
    return ('<TextBlock Canvas.Left="%d" Canvas.Top="%d" Text="{Binding %s}" FontSize="%d" '
            'Foreground="%s" FontWeight="%s"%s/>') % (x, y, binding, size, color, fw, extra)

def rect(x, y, ww, hh, fill, r=0, stroke=None, sw=0):
    s = '<Border Canvas.Left="%d" Canvas.Top="%d" Width="%d" Height="%d" Background="%s" CornerRadius="%d"' % (x, y, ww, hh, fill, r)
    if stroke:
        s += ' BorderBrush="%s" BorderThickness="%d"' % (stroke, sw)
    return s + '/>'

def vis_style(binding, value, target='Border'):
    # a Style that keeps the element Collapsed until binding == value
    return ('<%s.Style><Style TargetType="%s"><Setter Property="Visibility" Value="Collapsed"/>'
            '<Style.Triggers><DataTrigger Binding="{Binding %s}" Value="%s">'
            '<Setter Property="Visibility" Value="Visible"/></DataTrigger>'
            '</Style.Triggers></Style></%s.Style>') % (target, target, binding, value, target)

# ---------------------------------------------------------------- document head + resources
def head():
    w('<?xml version="1.0" encoding="utf-8"?>')
    w('<Grid xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"')
    w('      xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"')
    w('      Background="%s">' % APPBG)
    w('  <Viewbox Stretch="Uniform">')
    w('    <Canvas Width="%d" Height="%d">' % (CW, CH))
    resources()

def resources():
    w('      <Canvas.Resources>')
    # button template shared shape: rounded border + centered content
    for key, bg, fg, over in [
        ('KeyBtn', CARD, INK, WASH),
        ('PillBtn', BRAND, '#FFFFFFFF', '#FF4B5BF0'),
        ('GhostBtn', '#00000000', INK, WASH),
        ('AnsBtn', CARD, INK, WASH),
        ('CardBtn', CARD, INK, '#FFF7F9FE'),
    ]:
        w('        <Style x:Key="%s" TargetType="Button">' % key)
        w('          <Setter Property="Foreground" Value="%s"/>' % fg)
        w('          <Setter Property="FontWeight" Value="Bold"/>')
        w('          <Setter Property="FontSize" Value="20"/>')
        w('          <Setter Property="Cursor" Value="Hand"/>')
        w('          <Setter Property="Template">')
        w('            <Setter.Value>')
        w('              <ControlTemplate TargetType="Button">')
        w('                <Border x:Name="bd" Background="%s" CornerRadius="12" BorderBrush="%s" BorderThickness="1">' % (bg, LINE))
        w('                  <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>')
        w('                </Border>')
        w('                <ControlTemplate.Triggers>')
        w('                  <Trigger Property="IsMouseOver" Value="True">')
        w('                    <Setter TargetName="bd" Property="Background" Value="%s"/>' % over)
        w('                  </Trigger>')
        w('                  <Trigger Property="IsPressed" Value="True">')
        w('                    <Setter TargetName="bd" Property="BorderBrush" Value="%s"/>' % BRAND)
        w('                    <Setter TargetName="bd" Property="BorderThickness" Value="2"/>')
        w('                  </Trigger>')
        w('                </ControlTemplate.Triggers>')
        w('              </ControlTemplate>')
        w('            </Setter.Value>')
        w('          </Setter>')
        w('        </Style>')
    # nav rail button: transparent, light text, highlight on hover
    for key, accent in [('Nav0', SEC['0']), ('Nav1', SEC['1']), ('Nav2', SEC['2']), ('Nav3', SEC['3']), ('NavN', '#FF9AA6C4')]:
        w('        <Style x:Key="%s" TargetType="Button">' % key)
        w('          <Setter Property="Foreground" Value="#FFFFFFFF"/>')
        w('          <Setter Property="FontWeight" Value="Bold"/>')
        w('          <Setter Property="FontSize" Value="21"/>')
        w('          <Setter Property="HorizontalContentAlignment" Value="Left"/>')
        w('          <Setter Property="Cursor" Value="Hand"/>')
        w('          <Setter Property="Template">')
        w('            <Setter.Value>')
        w('              <ControlTemplate TargetType="Button">')
        w('                <Border x:Name="bd" Background="#00000000" CornerRadius="12" Padding="14,0,0,0">')
        w('                  <Grid>')
        w('                    <Border Width="6" Height="30" CornerRadius="3" HorizontalAlignment="Left" Background="%s"/>' % accent)
        w('                    <ContentPresenter Margin="22,0,0,0" HorizontalAlignment="Left" VerticalAlignment="Center"/>')
        w('                  </Grid>')
        w('                </Border>')
        w('                <ControlTemplate.Triggers>')
        w('                  <Trigger Property="IsMouseOver" Value="True">')
        w('                    <Setter TargetName="bd" Property="Background" Value="#22FFFFFF"/>')
        w('                  </Trigger>')
        w('                </ControlTemplate.Triggers>')
        w('              </ControlTemplate>')
        w('            </Setter.Value>')
        w('          </Setter>')
        w('        </Style>')
    w('      </Canvas.Resources>')

def button(x, y, ww, hh, style, command, content=None, binding=None, fs=None):
    s = '<Button Canvas.Left="%d" Canvas.Top="%d" Width="%d" Height="%d" Style="{StaticResource %s}" Command="{Binding %s}"' % (x, y, ww, hh, style, command)
    if fs:
        s += ' FontSize="%d"' % fs
    if binding:
        s += ' Content="{Binding %s}"/>' % binding
    elif content is not None:
        s += ' Content="%s"/>' % esc(content)
    else:
        s += '/>'
    return s

# ---------------------------------------------------------------- nav rail
def nav_rail():
    w(rect(0, 0, 210, CH, RAIL, 0))
    w(text(26, 34, 'CREATOR', 26, '#FFFFFFFF'))
    w(text(26, 66, 'ACADEMY', 26, BRAND.replace('#FF', '#FF')))
    w(rect(26, 104, 158, 2, '#33FFFFFF'))
    w(text(30, 120, 'LEARN', 16, '#FF9AA6C4'))
    labels = ['Blender', 'Photoshop', 'Canva', 'Horizon']
    y = 146
    for i, lb in enumerate(labels):
        w(button(14, y, 182, 50, 'Nav%d' % i, 'navSec%d' % i, content=lb))
        y += 56
    y += 10
    w(text(30, y, 'TOOLS', 16, '#FF9AA6C4')); y += 26
    w(button(14, y, 182, 46, 'NavN', 'navHome', content='Home')); y += 52
    w(button(14, y, 182, 46, 'NavN', 'navSearch', content='Search')); y += 52
    w(button(14, y, 182, 46, 'NavN', 'navBookmarks', content='Bookmarks')); y += 52
    # waiting / error chips at the bottom
    w('<Border Canvas.Left="14" Canvas.Top="%d" Width="182" Height="40" Background="#33FF4D4D" CornerRadius="10">' % (CH - 60))
    w(vis_style('errShow', '1'))
    w(bind_text(0, 0, 'err', 16, '#FFFFFFFF', w_=182, wrap=True, align='Center'))
    w('</Border>')

# ---------------------------------------------------------------- content frame
CX = 230                      # content left
CWID = CW - CX - 20           # content width

def content_open():
    # a page-in animation holder driven by {Binding pulse}
    w('<Canvas Canvas.Left="%d" Canvas.Top="0" Width="%d" Height="%d">' % (CX, CW - CX, CH))
    w('  <Canvas.RenderTransform><TranslateTransform x:Name="pageT" Y="0"/></Canvas.RenderTransform>')
    # pulse-driven page-in storyboard (flips between 0 and 1 on every state change)
    w('  <Canvas.Style>')
    w('    <Style TargetType="Canvas">')
    w('      <Style.Triggers>')
    for val in ('0', '1'):
        w('        <DataTrigger Binding="{Binding pulse}" Value="%s">' % val)
        w('          <DataTrigger.EnterActions><BeginStoryboard><Storyboard>')
        w('            <DoubleAnimation Storyboard.TargetName="pageT" Storyboard.TargetProperty="Y" From="14" To="0" Duration="0:0:0.22"/>')
        w('          </Storyboard></BeginStoryboard></DataTrigger.EnterActions>')
        w('        </DataTrigger>')
    w('      </Style.Triggers>')
    w('    </Style>')
    w('  </Canvas.Style>')

def content_close():
    w('</Canvas>')

# ---------------------------------------------------------------- HOME pane
def pane_home():
    w('<Border Canvas.Left="0" Canvas.Top="0" Width="%d" Height="%d" Background="#00000000">' % (CW - CX, CH))
    w(vis_style('view', 'home'))
    w('  <Canvas>')
    w(text(40, 48, 'Learn to Create', 46, INK))
    w(text(40, 112, 'Tap a tool on the left, or a card below. Big, simple lessons with a picture on every page.', 22, SOFT, bold=False, w_=900, wrap=True))
    cards = [('0', 'h0'), ('1', 'h1'), ('2', 'h2'), ('3', 'h3')]
    positions = [(40, 190), (535, 190), (40, 460), (535, 460)]
    for (idx, pre), (cx, cy) in zip(cards, positions):
        w('  <Button Canvas.Left="%d" Canvas.Top="%d" Width="470" Height="240" Style="{StaticResource CardBtn}" Command="{Binding navSec%s}">' % (cx, cy, idx))
        w('    <Grid Width="470" Height="240">')
        w('      <Border Width="470" Height="10" VerticalAlignment="Top" CornerRadius="12,12,0,0" Background="%s"/>' % SEC[idx])
        w('      <TextBlock Margin="28,36,0,0" Text="%s" FontSize="34" FontWeight="Bold" Foreground="%s"/>' % (SECNAME[idx], INK))
        w('      <TextBlock Margin="28,92,28,0" Text="{Binding %sBlurb}" FontSize="21" FontWeight="Normal" Foreground="%s" TextWrapping="Wrap" Width="414"/>' % (pre, SOFT))
        w('      <TextBlock Margin="28,0,0,24" VerticalAlignment="Bottom" Text="{Binding %sCount}" FontSize="19" FontWeight="Bold" Foreground="%s"/>' % (pre, SEC[idx]))
        w('    </Grid>')
        w('  </Button>')
    w('  </Canvas>')
    w('</Border>')

# ---------------------------------------------------------------- LESSON pane
def pane_lesson():
    w('<Border Canvas.Left="0" Canvas.Top="0" Width="%d" Height="%d" Background="#00000000">' % (CW - CX, CH))
    w(vis_style('view', 'lesson'))
    w('  <Canvas>')
    # illustration
    w('  <Border Canvas.Left="30" Canvas.Top="30" Width="660" Height="372" CornerRadius="16" Background="%s" BorderBrush="%s" BorderThickness="1">' % (CARD, LINE))
    w('    <Image Source="{Binding lsImg}" Width="640" Height="360" Stretch="Uniform"/>')
    w('  </Border>')
    # right column
    rx = 716
    w(bind_text(rx, 34, 'lsCounter', 18, SOFT))
    # level chip (color by lsLevel)
    w('  <Border Canvas.Left="%d" Canvas.Top="30" Width="92" Height="30" CornerRadius="15">' % (rx + 150))
    w('    <Border.Style><Style TargetType="Border"><Setter Property="Background" Value="%s"/><Style.Triggers>' % AMBER)
    w('      <DataTrigger Binding="{Binding lsLevel}" Value="Start"><Setter Property="Background" Value="%s"/></DataTrigger>' % GREEN)
    w('      <DataTrigger Binding="{Binding lsLevel}" Value="Pro"><Setter Property="Background" Value="%s"/></DataTrigger>' % RED)
    w('    </Style.Triggers></Style></Border.Style>')
    w('    <TextBlock Text="{Binding lsLevel}" FontSize="16" FontWeight="Bold" Foreground="#FFFFFFFF" HorizontalAlignment="Center" VerticalAlignment="Center"/>')
    w('  </Border>')
    w(bind_text(rx, 70, 'lsTitle', 34, INK, w_=520, wrap=True))
    w(bind_text(rx, 150, 'lsSub', 22, SOFT, bold=False, w_=520, wrap=True))
    # steps
    sy = 196
    for i in range(6):
        w('  <Border Canvas.Left="%d" Canvas.Top="%d" Width="520" Height="48" Background="#00000000">' % (rx, sy + i * 52))
        w(vis_style('st%dShow' % i, '1'))
        w('    <Canvas>')
        w('      <Border Width="30" Height="30" CornerRadius="15" Background="%s"><TextBlock Text="{Binding st%dN}" FontSize="16" FontWeight="Bold" Foreground="#FFFFFFFF" HorizontalAlignment="Center" VerticalAlignment="Center"/></Border>' % (BRAND, i))
        w('      <TextBlock Canvas.Left="42" Text="{Binding st%d}" FontSize="19" FontWeight="Normal" Foreground="%s" TextWrapping="Wrap" Width="474"/>' % (i, INK))
        w('    </Canvas>')
        w('  </Border>')
    # tip box
    w('  <Border Canvas.Left="30" Canvas.Top="424" Width="660" Height="54" CornerRadius="12" Background="%s">' % WASH)
    w(vis_style('lsTipShow', '1'))
    w('    <TextBlock Margin="18,0,18,0" Text="{Binding lsTip}" FontSize="18" FontWeight="Bold" Foreground="%s" TextWrapping="Wrap" VerticalAlignment="Center"/>' % BRAND)
    w('  </Border>')
    # progress bar
    w(rect(30, 498, 560, 12, LINE, 6))
    w('  <Border Canvas.Left="30" Canvas.Top="498" Height="12" CornerRadius="6" Background="%s" Width="{Binding lsProgW}"/>' % BRAND)
    # controls
    w(button(30, 536, 150, 56, 'AnsBtn', 'btnPrev', content='< Back'))
    w(button(190, 536, 150, 56, 'AnsBtn', 'btnNext', content='Next >'))
    w(button(350, 536, 160, 56, 'PillBtn', 'btnMark', binding='lsMark'))
    w(button(540, 536, 150, 56, 'PillBtn', 'btnQuiz', content='Quiz'))
    w('  </Canvas>')
    w('</Border>')

# ---------------------------------------------------------------- SEARCH pane
def pane_search():
    w('<Border Canvas.Left="0" Canvas.Top="0" Width="%d" Height="%d" Background="#00000000">' % (CW - CX, CH))
    w(vis_style('view', 'search'))
    w('  <Canvas>')
    w(text(30, 34, 'Search the Academy', 34, INK))
    # query box
    w(rect(30, 90, 660, 56, CARD, 12, LINE, 1))
    w(bind_text(48, 104, 'sqQuery', 26, INK, w_=600))
    w('  <TextBlock Canvas.Left="48" Canvas.Top="104" Text="Type a word..." FontSize="24" FontWeight="Normal" Foreground="%s">' % SOFT)
    w(vis_style('srHint', '1', target='TextBlock'))
    w('  </TextBlock>')
    # keyboard
    rows = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM']
    ky = 170
    for r, row in enumerate(rows):
        kx = 30 + r * 22
        for ch in row:
            w(button(kx, ky + r * 64, 56, 56, 'KeyBtn', 'key%s' % ch, content=ch))
            kx += 62
    w(button(30, ky + 3 * 64, 150, 52, 'KeyBtn', 'keySpace', content='Space'))
    w(button(190, ky + 3 * 64, 150, 52, 'KeyBtn', 'keyBack', content='Delete'))
    w(button(350, ky + 3 * 64, 150, 52, 'KeyBtn', 'keyClear', content='Clear'))
    # results column
    rx = 716
    w(text(rx, 34, 'Results', 24, SOFT))
    for i in range(6):
        w('  <Button Canvas.Left="%d" Canvas.Top="%d" Width="524" Height="74" Command="{Binding openRes%d}">' % (rx, 74 + i * 82, i))
        w('    <Button.Style><Style TargetType="Button" BasedOn="{StaticResource CardBtn}"><Setter Property="Visibility" Value="Collapsed"/><Style.Triggers><DataTrigger Binding="{Binding sr%dShow}" Value="1"><Setter Property="Visibility" Value="Visible"/></DataTrigger></Style.Triggers></Style></Button.Style>' % i)
        w('    <Grid Width="524" Height="74"><Canvas>')
        w('      <TextBlock Canvas.Left="18" Canvas.Top="12" Text="{Binding sr%d}" FontSize="21" FontWeight="Bold" Foreground="%s" Width="486" TextTrimming="CharacterEllipsis"/>' % (i, INK))
        w('      <TextBlock Canvas.Left="18" Canvas.Top="42" Text="{Binding sr%dSub}" FontSize="17" FontWeight="Normal" Foreground="%s" Width="380" TextTrimming="CharacterEllipsis"/>' % (i, SOFT))
        w('      <TextBlock Canvas.Left="404" Canvas.Top="42" Text="{Binding sr%dTag}" FontSize="16" FontWeight="Bold" Foreground="%s" Width="104" TextAlignment="Right"/>' % (i, BRAND))
        w('    </Canvas></Grid>')
        w('  </Button>')
    w('  <TextBlock Canvas.Left="%d" Canvas.Top="300" Text="No matches. Try another word." FontSize="20" FontWeight="Normal" Foreground="%s">' % (rx, SOFT))
    w(vis_style('srEmpty', '1', target='TextBlock'))
    w('  </TextBlock>')
    w('  </Canvas>')
    w('</Border>')

# ---------------------------------------------------------------- BOOKMARKS pane
def pane_bookmarks():
    w('<Border Canvas.Left="0" Canvas.Top="0" Width="%d" Height="%d" Background="#00000000">' % (CW - CX, CH))
    w(vis_style('view', 'bookmarks'))
    w('  <Canvas>')
    w(text(30, 34, 'Your Bookmarks', 34, INK))
    w(bind_text(400, 46, 'bmCount', 20, SOFT))
    for i in range(8):
        col = i % 2
        row = i // 2
        bx = 30 + col * 610
        by = 96 + row * 150
        w('  <Button Canvas.Left="%d" Canvas.Top="%d" Width="580" Height="130" Command="{Binding openBm%d}">' % (bx, by, i))
        w('    <Button.Style><Style TargetType="Button" BasedOn="{StaticResource CardBtn}"><Setter Property="Visibility" Value="Collapsed"/><Style.Triggers><DataTrigger Binding="{Binding bm%dShow}" Value="1"><Setter Property="Visibility" Value="Visible"/></DataTrigger></Style.Triggers></Style></Button.Style>' % i)
        w('    <Grid Width="580" Height="130"><Canvas>')
        w('      <Border Canvas.Left="0" Canvas.Top="0" Width="8" Height="130" Background="%s"/>' % BRAND)
        w('      <TextBlock Canvas.Left="28" Canvas.Top="24" Text="{Binding bm%d}" FontSize="23" FontWeight="Bold" Foreground="%s" Width="520" TextWrapping="Wrap"/>' % (i, INK))
        w('      <TextBlock Canvas.Left="28" Canvas.Top="86" Text="{Binding bm%dTag}" FontSize="16" FontWeight="Bold" Foreground="%s"/>' % (i, SEC['3']))
        w('    </Canvas></Grid>')
        w('  </Button>')
    w('  <TextBlock Canvas.Left="30" Canvas.Top="300" Text="No bookmarks yet. Open a lesson and tap Save to keep it here." FontSize="22" FontWeight="Normal" Foreground="%s" Width="900" TextWrapping="Wrap">' % SOFT)
    w(vis_style('bmEmpty', '1', target='TextBlock'))
    w('  </TextBlock>')
    w('  </Canvas>')
    w('</Border>')

# ---------------------------------------------------------------- QUIZ pane
def pane_quiz():
    w('<Border Canvas.Left="0" Canvas.Top="0" Width="%d" Height="%d" Background="#00000000">' % (CW - CX, CH))
    w(vis_style('view', 'quiz'))
    w('  <Canvas>')
    w(text(30, 34, 'Quiz', 34, INK))
    w(bind_text(130, 44, 'qzNum', 22, SOFT))
    w(rect(30, 92, 720, 150, WASH, 16))
    w(bind_text(54, 116, 'qzQ', 28, INK, w_=672, wrap=True))
    ans = [('qzA', 'ansA', 'qzRightA'), ('qzB', 'ansB', 'qzRightB'), ('qzC', 'ansC', 'qzRightC')]
    ay = 268
    for i, (txt, cmd, right) in enumerate(ans):
        w('  <Button Canvas.Left="30" Canvas.Top="%d" Width="720" Height="72" Command="{Binding %s}" Content="{Binding %s}" FontSize="24">' % (ay + i * 84, cmd, txt))
        w('    <Button.Style><Style TargetType="Button" BasedOn="{StaticResource AnsBtn}"><Setter Property="FontSize" Value="24"/>')
        w('      <Style.Triggers><DataTrigger Binding="{Binding %s}" Value="1">' % right)
        w('        <Setter Property="Foreground" Value="#FFFFFFFF"/></DataTrigger></Style.Triggers></Style></Button.Style>')
        w('  </Button>')
    # correct-answer green overlays (shown only on reveal via right flag)
    for i, (_t, _c, right) in enumerate(ans):
        w('  <Border Canvas.Left="30" Canvas.Top="%d" Width="720" Height="72" CornerRadius="12" Background="#332EB88A" BorderBrush="%s" BorderThickness="3">' % (ay + i * 84, GREEN))
        w(vis_style(right, '1'))
        w('    <TextBlock Text="Correct answer" FontSize="16" FontWeight="Bold" Foreground="%s" HorizontalAlignment="Right" VerticalAlignment="Top" Margin="0,8,14,0"/>' % GREEN)
        w('  </Border>')
    w(bind_text(30, 536, 'qzBanner', 24, BRAND, w_=560, wrap=True))
    w(button(600, 528, 150, 56, 'PillBtn', 'quizNext', content='Next'))
    # mini leaderboard
    lx = 780
    w(rect(lx, 92, CWID - lx - 10, 492, CARD, 16, LINE, 1))
    w(text(lx + 24, 112, 'Scoreboard', 22, INK))
    for i in range(5):
        w('  <TextBlock Canvas.Left="%d" Canvas.Top="%d" Text="{Binding ql%d}" FontSize="21" FontWeight="Bold" Foreground="%s" Width="%d" TextTrimming="CharacterEllipsis"/>' % (lx + 24, 158 + i * 46, i, INK, CWID - lx - 48))
    w(button(lx + 24, 520, 150, 46, 'GhostBtn', 'quizClose', content='Quit'))
    w('  </Canvas>')
    w('</Border>')

# ---------------------------------------------------------------- RESULT pane
def pane_result():
    w('<Border Canvas.Left="0" Canvas.Top="0" Width="%d" Height="%d" Background="#00000000">' % (CW - CX, CH))
    w(vis_style('view', 'result'))
    w('  <Canvas>')
    w(text(40, 60, 'Quiz Complete', 46, INK))
    w(bind_text(40, 126, 'rsTitle', 24, SOFT))
    w(rect(40, 180, 700, 420, CARD, 16, LINE, 1))
    w(text(70, 204, 'Final Scores', 26, INK))
    for i in range(5):
        w('  <TextBlock Canvas.Left="70" Canvas.Top="%d" Text="{Binding rl%d}" FontSize="26" FontWeight="Bold" Foreground="%s" Width="640" TextTrimming="CharacterEllipsis"/>' % (256 + i * 58, i, INK))
    w('  <TextBlock Canvas.Left="70" Canvas.Top="300" Text="Scores save to the AcademyQuiz leaderboard." FontSize="20" FontWeight="Normal" Foreground="%s" Width="600" TextWrapping="Wrap">' % SOFT)
    w(vis_style('rsEmpty', '1', target='TextBlock'))
    w('  </TextBlock>')
    w(button(40, 624, 200, 60, 'PillBtn', 'btnQuiz', content='Play Again'))
    w(button(252, 624, 200, 60, 'AnsBtn', 'navHome', content='Home'))
    w('  </Canvas>')
    w('</Border>')

# ---------------------------------------------------------------- waiting overlay
def waiting():
    w('<Border Canvas.Left="0" Canvas.Top="0" Width="%d" Height="%d" Background="%s">' % (CW, CH, APPBG))
    w(vis_style('ready', '0'))
    w('  <TextBlock Text="Connecting to Creator Academy..." FontSize="30" FontWeight="Bold" Foreground="%s" HorizontalAlignment="Center" VerticalAlignment="Center"/>' % SOFT)
    w('</Border>')

def tail():
    w('    </Canvas>')
    w('  </Viewbox>')
    w('</Grid>')

def build():
    head()
    nav_rail()
    content_open()
    pane_home()
    pane_lesson()
    pane_search()
    pane_bookmarks()
    pane_quiz()
    pane_result()
    content_close()
    waiting()
    tail()
    return '\n'.join(out) + '\n'

if __name__ == '__main__':
    xml = build()
    path = sys.argv[1] if len(sys.argv) > 1 else 'AcademyPanel.xaml'
    open(path, 'w').write(xml)
    print('wrote', path, len(xml), 'bytes')
